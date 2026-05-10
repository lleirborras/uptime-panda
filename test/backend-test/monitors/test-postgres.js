const { describe, test } = require("node:test");
const assert = require("node:assert");
const { PostgreSqlContainer } = require("@testcontainers/postgresql");
const { PostgresMonitorType } = require("../../../server/monitor-types/postgres");
const { UP, PENDING } = require("../../../src/util");

describe(
    "Postgres Single Node",
    {
        skip: !!process.env.CI && (process.platform !== "linux" || process.arch !== "x64"),
    },
    () => {
        test("check() sets status to UP when Postgres server is reachable", async () => {
            // The default timeout of 30 seconds might not be enough for the container to start
            const postgresContainer = await new PostgreSqlContainer("postgres:latest")
                .withStartupTimeout(60000)
                .start();
            const postgresMonitor = new PostgresMonitorType();
            const monitor = {
                database_connection_string: postgresContainer.getConnectionUri(),
            };

            const heartbeat = {
                msg: "",
                status: PENDING,
            };

            try {
                await postgresMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                postgresContainer.stop();
            }
        });

        test("check() rejects when Postgres server is not reachable", async () => {
            const postgresMonitor = new PostgresMonitorType();
            const monitor = {
                database_connection_string: "http://localhost:15432",
            };

            const heartbeat = {
                msg: "",
                status: PENDING,
            };

            // regex match any string
            const regex = /.+/;

            await assert.rejects(postgresMonitor.check(monitor, heartbeat, {}), regex);
        });

        test("check() succeeds with bind_interface set to loopback (127.0.0.1)", async () => {
            const postgresContainer = await new PostgreSqlContainer("postgres:latest")
                .withStartupTimeout(60000)
                .start();

            const postgresMonitor = new PostgresMonitorType();
            const monitor = {
                // Force 127.0.0.1 — getConnectionUri() uses "localhost" which may resolve to
                // ::1 on Linux, causing IPv4 localAddress to be bound to an IPv6 socket (EINVAL)
                database_connection_string: postgresContainer.getConnectionUri().replace("localhost", "127.0.0.1"),
                bind_interface: "127.0.0.1",
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await postgresMonitor.check(monitor, heartbeat, {});
                assert.strictEqual(heartbeat.status, UP);
            } finally {
                postgresContainer.stop();
            }
        });

        test("check() rejects when bind_interface is an address not on this host (192.0.2.1)", async () => {
            const postgresContainer = await new PostgreSqlContainer("postgres:latest")
                .withStartupTimeout(60000)
                .start();

            const postgresMonitor = new PostgresMonitorType();
            const monitor = {
                database_connection_string: postgresContainer.getConnectionUri().replace("localhost", "127.0.0.1"),
                bind_interface: "192.0.2.1",
            };

            const heartbeat = { msg: "", status: PENDING };

            try {
                await assert.rejects(postgresMonitor.check(monitor, heartbeat, {}), /.+/);
            } finally {
                postgresContainer.stop();
            }
        });
    }
);
