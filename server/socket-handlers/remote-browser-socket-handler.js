const { sendRemoteBrowserList } = require("../client");
const { RemoteBrowser } = require("../remote-browser");
const { onAuthed } = require("../utils/authed-event");

const { log } = require("../../src/util");
const { testRemoteBrowser } = require("../monitor-types/real-browser-monitor-type");

/**
 * Handlers for docker hosts
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.remoteBrowserSocketHandler = (socket) => {
    onAuthed(socket, "addRemoteBrowser", async (socket, remoteBrowser, remoteBrowserID, callback) => {
        let remoteBrowserBean = await RemoteBrowser.save(remoteBrowser, remoteBrowserID, socket.userID);
        await sendRemoteBrowserList(socket);

        callback({
            ok: true,
            msg: "Saved.",
            msgi18n: true,
            id: remoteBrowserBean.id,
        });
    }, { fallbackMsg: "Failed to save remote browser" });

    onAuthed(socket, "deleteRemoteBrowser", async (socket, dockerHostID, callback) => {
        await RemoteBrowser.delete(dockerHostID, socket.userID);
        await sendRemoteBrowserList(socket);

        callback({
            ok: true,
            msg: "successDeleted",
            msgi18n: true,
        });
    }, { fallbackMsg: "Failed to delete remote browser" });

    onAuthed(socket, "testRemoteBrowser", async (socket, remoteBrowser, callback) => {
        try {
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
            throw e;
        }
    }, { fallbackMsg: "Failed to test remote browser" });
};
