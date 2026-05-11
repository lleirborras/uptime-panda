const { describe, test } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const { MongodbMonitorType } = require("../../../server/monitor-types/mongodb");
const { UP, PENDING } = require("../../../src/util");

describe(
    "MongoDB Monitor",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("check() sets status to UP when MongoDB server is reachable", async () => {
            const container = await new GenericContainer("mongo:7")
                .withExposedPorts(27017)
                .withWaitStrategy(Wait.forLogMessage("Waiting for connections"))
                .withStartupTimeout(60000)
                .start();

            const mongoMonitor = new MongodbMonitorType();
            const monitor = {
                database_connection_string: `mongodb://${container.getHost()}:${container.getMappedPort(27017)}`,
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await mongoMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                await container.stop();
            }
        });

        test("check() rejects when MongoDB server is not reachable", async () => {
            const mongoMonitor = new MongodbMonitorType();
            const monitor = {
                database_connection_string: "mongodb://localhost:37017",
            };

            const heartbeat = { msg: "", status: PENDING };

            await assert.rejects(mongoMonitor.check(monitor, heartbeat, {}), /.+/);
        });

        test("check() succeeds with bind_interface set to loopback (127.0.0.1)", async () => {
            const container = await new GenericContainer("mongo:7")
                .withExposedPorts(27017)
                .withWaitStrategy(Wait.forLogMessage("Waiting for connections"))
                .withStartupTimeout(60000)
                .start();

            const mongoMonitor = new MongodbMonitorType();
            const monitor = {
                // Use 127.0.0.1 explicitly — container.getHost() may return "localhost" which
                // resolves to ::1 on some Linux systems, causing IPv4 localAddress binding to fail
                database_connection_string: `mongodb://127.0.0.1:${container.getMappedPort(27017)}`,
                bind_interface: "127.0.0.1",
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await mongoMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                await container.stop();
            }
        });

        test("check() rejects when bind_interface is an address not on this host (192.0.2.1)", async () => {
            const container = await new GenericContainer("mongo:7")
                .withExposedPorts(27017)
                .withWaitStrategy(Wait.forLogMessage("Waiting for connections"))
                .withStartupTimeout(60000)
                .start();

            const mongoMonitor = new MongodbMonitorType();
            const monitor = {
                database_connection_string: `mongodb://127.0.0.1:${container.getMappedPort(27017)}`,
                bind_interface: "192.0.2.1",
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await assert.rejects(mongoMonitor.check(monitor, heartbeat, {}), /.+/);
            } finally {
                await container.stop();
            }
        });
    }
);
