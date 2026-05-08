const { checkLogin } = require("../util-server");
const { Notification } = require("../notification");
const { sendNotificationList } = require("../client");
const { onAuthed } = require("../utils/authed-event");

/**
 * Handlers for notification configuration and testing.
 * Extracted from server/server.js as part of the H-1 monolith breakup.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.notificationSocketHandler = (socket) => {
    // Add or Edit
    onAuthed(
        socket,
        "addNotification",
        async (socket, notification, notificationID, callback) => {
            let notificationBean = await Notification.save(notification, notificationID, socket.userID);
            await sendNotificationList(socket);

            callback({
                ok: true,
                msg: "Saved.",
                msgi18n: true,
                id: notificationBean.id,
            });
        },
        { fallbackMsg: "Failed to save notification" }
    );

    onAuthed(
        socket,
        "deleteNotification",
        async (socket, notificationID, callback) => {
            await Notification.delete(notificationID, socket.userID);
            await sendNotificationList(socket);

            callback({
                ok: true,
                msg: "successDeleted",
                msgi18n: true,
            });
        },
        { fallbackMsg: "Failed to delete notification" }
    );

    onAuthed(
        socket,
        "testNotification",
        async (socket, notification, callback) => {
            let msg = await Notification.send(notification, notification.name + " Testing");

            callback({
                ok: true,
                msg,
            });
        },
        { fallbackMsg: "Failed to send test notification" }
    );

    // checkApprise: kept as manual handler because its contract is to call back
    // with a bare `false` (not an `{ ok: false, msg }` envelope) when auth or
    // the underlying check fails. test-notification-handler.js asserts this
    // shape; routing through onAuthed/socketError would change the envelope.
    socket.on("checkApprise", async (callback) => {
        try {
            checkLogin(socket);
            callback(await Notification.checkApprise());
        } catch (e) {
            callback(false);
        }
    });
};
