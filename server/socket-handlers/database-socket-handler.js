const Database = require("../database");
const { onAuthed } = require("../utils/authed-event");

/**
 * Handlers for database
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.databaseSocketHandler = (socket) => {
    // Post or edit incident
    onAuthed(socket, "getDatabaseSize", async (socket, callback) => {
        callback({
            ok: true,
            size: await Database.getSize(),
        });
    }, { fallbackMsg: "Failed to get database size" });

    onAuthed(socket, "shrinkDatabase", async (socket, callback) => {
        await Database.shrink();
        callback({
            ok: true,
        });
    }, { fallbackMsg: "Failed to shrink database" });
};
