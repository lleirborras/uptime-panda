const { sendDockerHostList } = require("../client");
const { DockerHost } = require("../docker");
const { log } = require("../../src/util");
const { onAuthed } = require("../utils/authed-event");

/**
 * Handlers for docker hosts
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.dockerSocketHandler = (socket) => {
    onAuthed(
        socket,
        "addDockerHost",
        async (socket, dockerHost, dockerHostID, callback) => {
            let dockerHostBean = await DockerHost.save(dockerHost, dockerHostID, socket.userID);
            await sendDockerHostList(socket);

            callback({
                ok: true,
                msg: "Saved.",
                msgi18n: true,
                id: dockerHostBean.id,
            });
        },
        { fallbackMsg: "Failed to save docker host" }
    );

    onAuthed(
        socket,
        "deleteDockerHost",
        async (socket, dockerHostID, callback) => {
            await DockerHost.delete(dockerHostID, socket.userID);
            await sendDockerHostList(socket);

            callback({
                ok: true,
                msg: "successDeleted",
                msgi18n: true,
            });
        },
        { fallbackMsg: "Failed to delete docker host" }
    );

    onAuthed(
        socket,
        "testDockerHost",
        async (socket, dockerHost, callback) => {
            try {
                let amount = await DockerHost.testDockerHost(dockerHost);
                let msg;

                if (amount >= 1) {
                    msg = "Connected Successfully. Amount of containers: " + amount;
                } else {
                    msg = "Connected Successfully, but there are no containers?";
                }

                callback({
                    ok: true,
                    msg,
                });
            } catch (e) {
                log.error("docker", e);
                throw e;
            }
        },
        { fallbackMsg: "Failed to test docker host" }
    );
};
