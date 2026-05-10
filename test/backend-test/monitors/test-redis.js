const { describe, test } = require("node:test");
const assert = require("node:assert");
const { GenericContainer, Wait } = require("testcontainers");
const { RedisMonitorType } = require("../../../server/monitor-types/redis");
const { UP, PENDING } = require("../../../src/util");

describe(
    "Redis Monitor",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("check() sets status to UP when Redis server is reachable", async () => {
            const container = await new GenericContainer("redis:7-alpine")
                .withExposedPorts(6379)
                .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
                .withStartupTimeout(60000)
                .start();

            const redisMonitor = new RedisMonitorType();
            const monitor = {
                database_connection_string: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
                ignore_tls: true,
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await redisMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                await container.stop();
            }
        });

        test("check() rejects when Redis server is not reachable", async () => {
            const redisMonitor = new RedisMonitorType();
            const monitor = {
                database_connection_string: "redis://localhost:16379",
                ignore_tls: true,
            };

            const heartbeat = { msg: "", status: PENDING };

            await assert.rejects(redisMonitor.check(monitor, heartbeat, {}), /.+/);
        });

        test("check() succeeds with bind_interface set to loopback (127.0.0.1)", async () => {
            const container = await new GenericContainer("redis:7-alpine")
                .withExposedPorts(6379)
                .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
                .withStartupTimeout(60000)
                .start();

            const redisMonitor = new RedisMonitorType();
            const monitor = {
                // Use 127.0.0.1 explicitly — container.getHost() may return "localhost" which
                // resolves to ::1 on some Linux systems, causing IPv4 localAddress binding to fail
                database_connection_string: `redis://127.0.0.1:${container.getMappedPort(6379)}`,
                ignore_tls: true,
                bind_interface: "127.0.0.1",
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await redisMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                await container.stop();
            }
        });

        test("check() rejects when bind_interface is an address not on this host (192.0.2.1)", async () => {
            const container = await new GenericContainer("redis:7-alpine")
                .withExposedPorts(6379)
                .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
                .withStartupTimeout(60000)
                .start();

            const redisMonitor = new RedisMonitorType();
            const monitor = {
                database_connection_string: `redis://127.0.0.1:${container.getMappedPort(6379)}`,
                ignore_tls: true,
                bind_interface: "192.0.2.1",
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await assert.rejects(redisMonitor.check(monitor, heartbeat, {}), /.+/);
            } finally {
                await container.stop();
            }
        });
    }
);
