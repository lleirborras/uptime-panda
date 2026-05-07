const { log } = require("../../src/util");
const { getKnex } = require("../db");
const apicache = require("../modules/apicache");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const Maintenance = require("../model/maintenance");
const maintenanceCache = require("../maintenance-cache");
const { UserFacingError } = require("../utils/socket-error");
const { onAuthed } = require("../utils/authed-event");
const server = UptimeKumaServer.getInstance();

const MAINTENANCE_PAYLOAD_FIELDS = [
    "title", "description", "strategy", "interval_day", "timezone", "active",
    "start_date", "end_date", "start_time", "end_time", "weekdays",
    "days_of_month", "cron", "duration",
];

/**
 * Look up a maintenance and assert the caller owns it.
 * Prefers the in-memory bean (carries beanMeta for run/stop); falls back
 * to a DB lookup for handlers that only need ownership verification.
 * @param {number} maintenanceID Maintenance row id
 * @param {Socket} socket Socket.io socket carrying userID
 * @returns {Promise<Maintenance>} the owned maintenance bean
 * @throws {Error} "Permission denied." when missing or not owned
 */
async function requireOwnedMaintenance(maintenanceID, socket) {
    let bean = server.getMaintenance(maintenanceID);
    if (!bean) {
        bean = await Maintenance.query().findById(maintenanceID);
    }
    if (!bean || bean.user_id !== socket.userID) {
        throw new UserFacingError("Permission denied.");
    }
    return bean;
}

/**
 * Atomically replace every row in a maintenance link table.
 * @param {string} table Link table name
 * @param {string} foreignKeyCol Column referencing the linked entity
 * @param {number} maintenanceID Maintenance row id
 * @param {Array<{id:number}>} items Items to link
 * @returns {Promise<void>}
 */
async function replaceMaintenanceLinks(table, foreignKeyCol, maintenanceID, items) {
    await getKnex().transaction(async (trx) => {
        await trx(table).where("maintenance_id", maintenanceID).delete();
        for (const item of items) {
            await trx(table).insert({
                [foreignKeyCol]: item.id,
                maintenance_id: maintenanceID,
            });
        }
    });
}

/**
 * Project a maintenance bean down to the column subset stored on the row.
 * @param {Maintenance} bean Maintenance bean
 * @returns {object} insert/patch payload
 */
function maintenancePayload(bean) {
    const payload = {};
    for (const field of MAINTENANCE_PAYLOAD_FIELDS) {
        payload[field] = bean[field];
    }
    return payload;
}

/**
 * Handlers for Maintenance
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.maintenanceSocketHandler = (socket) => {
    // Add a new maintenance
    onAuthed(socket, "addMaintenance", async (socket, maintenance, callback) => {
        log.debug("maintenance", maintenance);

        let bean = await Maintenance.jsonToBean(new Maintenance(), maintenance);
        bean.user_id = socket.userID;

        const insertPayload = maintenancePayload(bean);
        insertPayload.user_id = bean.user_id;

        // Single row insert is atomic on its own, but wrap in a
        // transaction so future associated writes (status pages,
        // monitor links) added inside this handler stay atomic with it.
        const inserted = await getKnex().transaction(async (trx) => {
            return await Maintenance.query(trx).insertAndFetch(insertPayload);
        });
        // Reuse the in-memory bean (with beanMeta etc.) but adopt the assigned id.
        bean.id = inserted.id;

        // In-memory state and cron scheduling happen after commit so a
        // failed insert never leaves a scheduled-but-unsaved maintenance.
        server.maintenanceList[bean.id] = bean;
        await bean.run(true);

        await server.sendMaintenanceList(socket);

        callback({
            ok: true,
            msg: "successAdded",
            msgi18n: true,
            maintenanceID: bean.id,
        });
    }, { fallbackMsg: "Failed to add maintenance" });

    // Edit a maintenance
    onAuthed(socket, "editMaintenance", async (socket, maintenance, callback) => {
        const bean = await requireOwnedMaintenance(maintenance.id, socket);

        await Maintenance.jsonToBean(bean, maintenance);

        await Maintenance.query().patchAndFetchById(bean.id, maintenancePayload(bean));
        await bean.run(true);
        await server.sendMaintenanceList(socket);

        callback({
            ok: true,
            msg: "Saved.",
            msgi18n: true,
            maintenanceID: bean.id,
        });
    }, { fallbackMsg: "Failed to edit maintenance" });

    // Add a new monitor_maintenance
    onAuthed(socket, "addMonitorMaintenance", async (socket, maintenanceID, monitors, callback) => {
        await requireOwnedMaintenance(maintenanceID, socket);

        await replaceMaintenanceLinks("monitor_maintenance", "monitor_id", maintenanceID, monitors);

        // Refresh the in-memory cache (H-4) so subsequent heartbeats
        // observe the new monitor->maintenance links without a DB round-trip.
        await maintenanceCache.loadFromDb();

        apicache.clear();

        callback({
            ok: true,
            msg: "successAdded",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to add monitor maintenance" });

    // Add a new monitor_maintenance
    onAuthed(socket, "addMaintenanceStatusPage", async (socket, maintenanceID, statusPages, callback) => {
        await requireOwnedMaintenance(maintenanceID, socket);

        await replaceMaintenanceLinks("maintenance_status_page", "status_page_id", maintenanceID, statusPages);

        apicache.clear();

        callback({
            ok: true,
            msg: "successAdded",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to add maintenance status page" });

    onAuthed(socket, "getMaintenance", async (socket, maintenanceID, callback) => {
        log.debug("maintenance", `Get Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

        let bean = await Maintenance.query().where({ id: maintenanceID,
            user_id: socket.userID }).first();

        callback({
            ok: true,
            maintenance: await bean.toJSON(),
        });
    }, { fallbackMsg: "Failed to retrieve maintenance" });

    onAuthed(socket, "getMaintenanceList", async (socket, callback) => {
        await server.sendMaintenanceList(socket);
        callback({
            ok: true,
        });
    }, { fallbackMsg: "Failed to retrieve maintenance list" });

    onAuthed(socket, "getMonitorMaintenance", async (socket, maintenanceID, callback) => {
        log.debug("maintenance", `Get Monitors for Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

        const monitors = await getKnex()("monitor_maintenance as mm")
            .join("monitor", "mm.monitor_id", "monitor.id")
            .where("mm.maintenance_id", maintenanceID)
            .select("monitor.id");

        callback({
            ok: true,
            monitors,
        });
    }, { fallbackMsg: "Failed to retrieve monitors for maintenance" });

    onAuthed(socket, "getMaintenanceStatusPage", async (socket, maintenanceID, callback) => {
        log.debug("maintenance", `Get Status Pages for Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

        const statusPages = await getKnex()("maintenance_status_page as msp")
            .join("status_page", "msp.status_page_id", "status_page.id")
            .where("msp.maintenance_id", maintenanceID)
            .select("status_page.id", "status_page.title");

        callback({
            ok: true,
            statusPages,
        });
    }, { fallbackMsg: "Failed to retrieve status pages for maintenance" });

    onAuthed(socket, "deleteMaintenance", async (socket, maintenanceID, callback) => {
        log.debug("maintenance", `Delete Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

        if (maintenanceID in server.maintenanceList) {
            server.maintenanceList[maintenanceID].stop();
            delete server.maintenanceList[maintenanceID];
        }

        await getKnex()("maintenance").where({ id: maintenanceID,
            user_id: socket.userID }).delete();

        // The CASCADE on `monitor_maintenance` removed our links;
        // refresh the cache so the heartbeat hot path stays in sync (H-4).
        await maintenanceCache.loadFromDb();

        apicache.clear();

        callback({
            ok: true,
            msg: "successDeleted",
            msgi18n: true,
        });

        await server.sendMaintenanceList(socket);
    }, { fallbackMsg: "Failed to delete maintenance" });

    onAuthed(socket, "pauseMaintenance", async (socket, maintenanceID, callback) => {
        log.debug("maintenance", `Pause Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

        const maintenance = await requireOwnedMaintenance(maintenanceID, socket);

        maintenance.active = false;
        await maintenance.$query().patch({ active: false });
        maintenance.stop();

        apicache.clear();

        callback({
            ok: true,
            msg: "successPaused",
            msgi18n: true,
        });

        await server.sendMaintenanceList(socket);
    }, { fallbackMsg: "Failed to pause maintenance" });

    onAuthed(socket, "resumeMaintenance", async (socket, maintenanceID, callback) => {
        log.debug("maintenance", `Resume Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

        const maintenance = await requireOwnedMaintenance(maintenanceID, socket);

        maintenance.active = true;
        await maintenance.$query().patch({ active: true });
        await maintenance.run();

        apicache.clear();

        callback({
            ok: true,
            msg: "successResumed",
            msgi18n: true,
        });

        await server.sendMaintenanceList(socket);
    }, { fallbackMsg: "Failed to resume maintenance" });
};
