const { setSetting, setting, doubleCheckPassword } = require("../util-server");
const { CloudflaredTunnel } = require("node-cloudflared-tunnel");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { log } = require("../../src/util");
const { onAuthed } = require("../utils/authed-event");
const io = UptimeKumaServer.getInstance().io;

const prefix = "cloudflared_";
const cloudflared = new CloudflaredTunnel();

/**
 * Change running state
 * @param {string} running Is it running?
 * @param {string} message Message to pass
 * @returns {void}
 */
cloudflared.change = (running, message) => {
    io.to("cloudflared").emit(prefix + "running", running);
    io.to("cloudflared").emit(prefix + "message", message);
};

/**
 * Emit an error message
 * @param {string} errorMessage Error message to send
 * @returns {void}
 */
cloudflared.error = (errorMessage) => {
    io.to("cloudflared").emit(prefix + "errorMessage", errorMessage);
};

/**
 * Handler for cloudflared
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.cloudflaredSocketHandler = (socket) => {
    onAuthed(
        socket,
        prefix + "join",
        async (socket) => {
            socket.join("cloudflared");
            io.to(socket.userID).emit(prefix + "installed", cloudflared.checkInstalled());
            io.to(socket.userID).emit(prefix + "running", cloudflared.running);
            io.to(socket.userID).emit(prefix + "token", await setting("cloudflaredTunnelToken"));
        },
        { logNamespace: "cloudflared", fallbackMsg: "Failed to join cloudflared room" }
    );

    onAuthed(
        socket,
        prefix + "leave",
        async (socket) => {
            socket.leave("cloudflared");
        },
        { logNamespace: "cloudflared", fallbackMsg: "Failed to leave cloudflared room" }
    );

    onAuthed(
        socket,
        prefix + "start",
        async (socket, token) => {
            if (token && typeof token === "string") {
                await setSetting("cloudflaredTunnelToken", token);
                cloudflared.token = token;
            } else {
                cloudflared.token = null;
            }
            cloudflared.start();
        },
        { logNamespace: "cloudflared", fallbackMsg: "Failed to start cloudflared" }
    );

    onAuthed(
        socket,
        prefix + "stop",
        async (socket, currentPassword, callback) => {
            try {
                const disabledAuth = await setting("disableAuth");
                if (!disabledAuth) {
                    await doubleCheckPassword(socket, currentPassword);
                }
                cloudflared.stop();
            } catch (error) {
                // Preserve original behaviour: only the error path invokes the
                // callback; success path is silent (UI relies on `running` push).
                callback({
                    ok: false,
                    msg: error.message,
                });
            }
        },
        { logNamespace: "cloudflared", fallbackMsg: "Failed to stop cloudflared" }
    );

    onAuthed(
        socket,
        prefix + "removeToken",
        async () => {
            await setSetting("cloudflaredTunnelToken", "");
        },
        { logNamespace: "cloudflared", fallbackMsg: "Failed to remove cloudflared token" }
    );
};

/**
 * Automatically start cloudflared
 * @param {string} token Cloudflared tunnel token
 * @returns {Promise<void>}
 */
module.exports.autoStart = async (token) => {
    if (!token) {
        token = await setting("cloudflaredTunnelToken");
    } else {
        // Override the current token via args or env var
        await setSetting("cloudflaredTunnelToken", token);
        log.info("cloudflare", "Use cloudflared token from args or env var");
    }

    if (token) {
        log.info("cloudflare", "Start cloudflared");
        cloudflared.token = token;
        cloudflared.start();
    }
};

/**
 * Stop cloudflared
 * @returns {Promise<void>}
 */
module.exports.stop = async () => {
    log.info("cloudflared", "Stop cloudflared");
    if (cloudflared) {
        cloudflared.stop();
    }
};
