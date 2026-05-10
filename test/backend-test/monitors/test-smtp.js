const { describe, test } = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { SMTPMonitorType } = require("../../../server/monitor-types/smtp");
const { PENDING } = require("../../../src/util");

/**
 * Creates a minimal SMTP stub that accepts one connection and greets it
 * @returns {Promise<{server: net.Server, port: number}>} Server and port
 */
function createSmtpStub() {
    const server = net.createServer((socket) => {
        socket.write("220 stub ESMTP\r\n");
        socket.on("data", (data) => {
            const line = data.toString();
            if (line.startsWith("EHLO") || line.startsWith("HELO")) {
                socket.write("250-stub\r\n250 OK\r\n");
            } else if (line.startsWith("QUIT")) {
                socket.write("221 Bye\r\n");
                socket.end();
            }
        });
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            resolve({ server, port: server.address().port });
        });
    });
}

describe("SMTP Monitor", () => {
    test("check() succeeds with bind_interface set to loopback (127.0.0.1)", async (t) => {
        const { server, port } = await createSmtpStub();
        t.after(() => server.close());

        const smtpMonitor = new SMTPMonitorType();
        const monitor = {
            hostname: "127.0.0.1",
            port,
            smtp_security: "nostarttls",
            bind_interface: "127.0.0.1",
        };
        const heartbeat = { msg: "", status: PENDING };

        await smtpMonitor.check(monitor, heartbeat, {});
    });

    test("check() rejects when bind_interface is an address not on this host (192.0.2.1)", async () => {
        const smtpMonitor = new SMTPMonitorType();
        const monitor = {
            hostname: "127.0.0.1",
            port: 25,
            smtp_security: "nostarttls",
            bind_interface: "192.0.2.1",
        };
        const heartbeat = { msg: "", status: PENDING };

        await assert.rejects(smtpMonitor.check(monitor, heartbeat, {}), /.+/);
    });
});
