const { checkLogin } = require("../util-server");
const Database = require("../database");
const { socketError } = require("../utils/socket-error");

/**
 * Handlers for database
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.databaseSocketHandler = (socket) => {
    // Post or edit incident
    socket.on("getDatabaseSize", async (callback) => {
        try {
            checkLogin(socket);
            callback({
                ok: true,
                size: await Database.getSize(),
            });
        } catch (error) {
            socketError(callback, error, "Failed to get database size");
        }
    });

    socket.on("shrinkDatabase", async (callback) => {
        try {
            checkLogin(socket);
            await Database.shrink();
            callback({
                ok: true,
            });
        } catch (error) {
            socketError(callback, error, "Failed to shrink database");
        }
    });
};
