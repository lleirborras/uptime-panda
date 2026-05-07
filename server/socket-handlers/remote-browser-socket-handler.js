const { sendRemoteBrowserList } = require("../client");
const { checkLogin } = require("../util-server");
const { RemoteBrowser } = require("../remote-browser");

const { log } = require("../../src/util");
const { testRemoteBrowser } = require("../monitor-types/real-browser-monitor-type");
const { socketError } = require("../utils/socket-error");

/**
 * Handlers for docker hosts
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.remoteBrowserSocketHandler = (socket) => {
    socket.on("addRemoteBrowser", async (remoteBrowser, remoteBrowserID, callback) => {
        try {
            checkLogin(socket);

            let remoteBrowserBean = await RemoteBrowser.save(remoteBrowser, remoteBrowserID, socket.userID);
            await sendRemoteBrowserList(socket);

            callback({
                ok: true,
                msg: "Saved.",
                msgi18n: true,
                id: remoteBrowserBean.id,
            });
        } catch (e) {
            socketError(callback, e, "Failed to save remote browser");
        }
    });

    socket.on("deleteRemoteBrowser", async (dockerHostID, callback) => {
        try {
            checkLogin(socket);

            await RemoteBrowser.delete(dockerHostID, socket.userID);
            await sendRemoteBrowserList(socket);

            callback({
                ok: true,
                msg: "successDeleted",
                msgi18n: true,
            });
        } catch (e) {
            socketError(callback, e, "Failed to delete remote browser");
        }
    });

    socket.on("testRemoteBrowser", async (remoteBrowser, callback) => {
        try {
            checkLogin(socket);
            let check = await testRemoteBrowser(remoteBrowser.url);
            log.info("remoteBrowser", "Tested remote browser: " + check);
            let msg;

            if (check) {
                msg = "Connected Successfully.";
            }

            callback({
                ok: true,
                msg,
            });
        } catch (e) {
            log.error("remoteBrowser", e);
            socketError(callback, e, "Failed to test remote browser connection");
        }
    });
};
