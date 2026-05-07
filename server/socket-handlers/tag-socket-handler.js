const { getKnex } = require("../db");
const Tag = require("../model/tag");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { onAuthed } = require("../utils/authed-event");

const server = UptimeKumaServer.getInstance();

/**
 * Handlers for tag CRUD and monitor↔tag link table mutations.
 * Extracted from server/server.js as part of the H-1 monolith breakup.
 * All events run through onAuthed (M-4) so checkLogin is enforced
 * automatically and never relies on a hand-written try/catch.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.tagSocketHandler = (socket) => {
    onAuthed(socket, "getTags", async (socket, callback) => {
        const list = await Tag.query();

        callback({
            ok: true,
            tags: list.map((bean) => bean.toJSON()),
        });
    }, { fallbackMsg: "Failed to retrieve tags" });

    onAuthed(socket, "addTag", async (socket, tag, callback) => {
        const bean = await Tag.query().insertAndFetch({
            name: tag.name,
            color: tag.color,
        });

        callback({
            ok: true,
            tag: await bean.toJSON(),
        });
    }, { fallbackMsg: "Failed to add tag" });

    onAuthed(socket, "editTag", async (socket, tag, callback) => {
        let bean = await Tag.query().findById(tag.id);
        if (bean == null) {
            callback({
                ok: false,
                msg: "tagNotFound",
                msgi18n: true,
            });
            return;
        }
        bean.name = tag.name;
        bean.color = tag.color;
        await bean.$query().patch({ name: bean.name,
            color: bean.color });

        callback({
            ok: true,
            msg: "Saved.",
            msgi18n: true,
            tag: await bean.toJSON(),
        });
    }, { fallbackMsg: "Failed to edit tag" });

    onAuthed(socket, "deleteTag", async (socket, tagID, callback) => {
        await getKnex()("tag").where("id", tagID).delete();

        callback({
            ok: true,
            msg: "successDeleted",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to delete tag" });

    onAuthed(socket, "addMonitorTag", async (socket, tagID, monitorID, value, callback) => {
        await getKnex()("monitor_tag").insert({
            tag_id: tagID,
            monitor_id: monitorID,
            value,
        });

        await server.sendUpdateMonitorIntoList(socket, monitorID);

        callback({
            ok: true,
            msg: "successAdded",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to add monitor tag" });

    onAuthed(socket, "editMonitorTag", async (socket, tagID, monitorID, value, callback) => {
        await getKnex()("monitor_tag")
            .where({ tag_id: tagID,
                monitor_id: monitorID })
            .update({ value });

        await server.sendUpdateMonitorIntoList(socket, monitorID);

        callback({
            ok: true,
            msg: "successEdited",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to edit monitor tag" });

    onAuthed(socket, "deleteMonitorTag", async (socket, tagID, monitorID, value, callback) => {
        await getKnex()("monitor_tag")
            .where({ tag_id: tagID,
                monitor_id: monitorID,
                value })
            .delete();

        await server.sendUpdateMonitorIntoList(socket, monitorID);

        callback({
            ok: true,
            msg: "successDeleted",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to delete monitor tag" });
};
