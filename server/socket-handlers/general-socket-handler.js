const { log } = require("../../src/util");
const { Settings } = require("../settings");
const { sendInfo } = require("../client");
const { games } = require("gamedig");
const { testChrome } = require("../monitor-types/real-browser-monitor-type");
const fsAsync = require("fs").promises;
const path = require("path");
const { onAuthed } = require("../utils/authed-event");
const { UserFacingError } = require("../utils/socket-error");

/**
 * Get a game list via GameDig
 * @returns {object} list of games supported by GameDig
 */
function getGameList() {
    let gameList = [];
    gameList = Object.keys(games).map((key) => {
        const item = games[key];
        return {
            keys: [key],
            pretty: item.name,
            options: item.options,
            extra: item.extra || {},
        };
    });
    gameList.sort((a, b) => {
        if (a.pretty < b.pretty) {
            return -1;
        }
        if (a.pretty > b.pretty) {
            return 1;
        }
        return 0;
    });
    return gameList;
}

/**
 * Handler for general events
 * @param {Socket} socket Socket.io instance
 * @param {UptimeKumaServer} server Uptime Kuma server
 * @returns {void}
 */
module.exports.generalSocketHandler = (socket, server) => {
    onAuthed(
        socket,
        "initServerTimezone",
        async (socket, timezone) => {
            log.debug("generalSocketHandler", "Timezone: " + timezone);
            await Settings.set("initServerTimezone", true);
            await server.setTimezone(timezone);
            await sendInfo(socket);
        },
        { logNamespace: "initServerTimezone", fallbackMsg: "Failed to set timezone" }
    );

    onAuthed(
        socket,
        "getGameList",
        async (socket, callback) => {
            callback({
                ok: true,
                gameList: getGameList(),
            });
        },
        { fallbackMsg: "Failed to retrieve game list" }
    );

    onAuthed(
        socket,
        "testChrome",
        (socket, executable, callback) => {
            // Just noticed that await call could block the whole socket.io server!!! Use pure promise instead.
            testChrome(executable)
                .then((version) => {
                    callback({
                        ok: true,
                        msg: {
                            key: "foundChromiumVersion",
                            values: [version],
                        },
                        msgi18n: true,
                    });
                })
                .catch((e) => {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                });
        },
        { fallbackMsg: "Failed to test Chrome" }
    );

    onAuthed(
        socket,
        "getPushExample",
        async (socket, language, callback) => {
            if (!/^[a-z-]+$/.test(language)) {
                throw new UserFacingError("Invalid language");
            }

            try {
                let dir = path.join("./extra/push-examples", language);
                let files = await fsAsync.readdir(dir);

                for (let file of files) {
                    if (file.startsWith("index.")) {
                        callback({
                            ok: true,
                            code: await fsAsync.readFile(path.join(dir, file), "utf8"),
                        });
                        return;
                    }
                }
            } catch (e) {}

            callback({
                ok: false,
                msg: "Not found",
            });
        },
        { fallbackMsg: "Failed to get push example" }
    );

    // Disconnect all other socket clients of the user
    onAuthed(
        socket,
        "disconnectOtherSocketClients",
        async (socket) => {
            server.disconnectAllSocketClients(socket.userID, socket.id);
        },
        { logNamespace: "disconnectAllSocketClients", fallbackMsg: "Failed to disconnect other socket clients" }
    );
};
