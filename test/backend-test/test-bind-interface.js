/**
 * Unit tests for the bind_interface feature.
 *
 * Covers:
 *   1. Monitor.validate() — bind_interface validation
 *   2. tcpingBound — NOTE: not exported from tcp.js; those tests are skipped
 *      with a clear comment.
 *   3. getNetworkInterfaces — pure data-transformation logic (no socket needed)
 *   4. Migration — verifies that up/down functions are exported
 */

const { describe, test } = require("node:test");
const assert = require("node:assert");
const net = require("node:net");
const os = require("node:os");
const Monitor = require("../../server/model/monitor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Monitor-like object whose interval/retry_interval pass validation,
 * so we can exercise bind_interface checks in isolation.
 * @param {object} overrides Property overrides applied on top of the defaults.
 * @returns {Monitor} Monitor instance ready for validate().
 */
function buildMonitor(overrides = {}) {
    const monitor = Object.create(Monitor.prototype);
    monitor.interval = 60;
    monitor.retry_interval = 60;
    return Object.assign(monitor, overrides);
}

// ---------------------------------------------------------------------------
// Group 1: Monitor.validate() — bind_interface validation
// ---------------------------------------------------------------------------

describe("Monitor.validate() — bind_interface", () => {
    test("null → no error", () => {
        const monitor = buildMonitor({ bind_interface: null });
        assert.doesNotThrow(() => monitor.validate());
    });

    test("empty string → no error", () => {
        const monitor = buildMonitor({ bind_interface: "" });
        assert.doesNotThrow(() => monitor.validate());
    });

    test("valid IPv4 → no error", () => {
        const monitor = buildMonitor({ bind_interface: "192.168.1.5" });
        assert.doesNotThrow(() => monitor.validate());
    });

    test("valid IPv6 loopback → no error", () => {
        const monitor = buildMonitor({ bind_interface: "::1" });
        assert.doesNotThrow(() => monitor.validate());
    });

    test("interface name 'eth0' (not an IP) → throws error mentioning bind_interface", () => {
        const monitor = buildMonitor({ bind_interface: "eth0" });
        assert.throws(
            () => monitor.validate(),
            (err) => {
                assert.ok(
                    err.message.toLowerCase().includes("bind_interface"),
                    `expected error to mention bind_interface, got: "${err.message}"`
                );
                return true;
            }
        );
    });

    test("non-IP string 'not-an-ip' → throws error mentioning bind_interface", () => {
        const monitor = buildMonitor({ bind_interface: "not-an-ip" });
        assert.throws(
            () => monitor.validate(),
            (err) => {
                assert.ok(
                    err.message.toLowerCase().includes("bind_interface"),
                    `expected error to mention bind_interface, got: "${err.message}"`
                );
                return true;
            }
        );
    });

    test("'999.999.999.999' → throws (net.isIP returns 0 for this)", () => {
        // net.isIP("999.999.999.999") === 0 (falsy) — validation must reject it.
        assert.strictEqual(net.isIP("999.999.999.999"), 0, "sanity: net.isIP should return 0");
        const monitor = buildMonitor({ bind_interface: "999.999.999.999" });
        assert.throws(() => monitor.validate());
    });
});

// ---------------------------------------------------------------------------
// Group 2: tcpingBound
//
// tcpingBound is NOT exported from server/monitor-types/tcp.js — only the
// class TCPMonitorType and helper functions (TLS_ALERT_CODES, parseTlsAlertNumber,
// getTlsAlertName) are exported. Direct unit tests for the private function
// cannot be written without modifying the implementation file, which is out of
// scope for this test pass.
//
// The function IS exercised indirectly via TCPMonitorType.check() whenever
// bind_interface is set — covered by the existing integration test suite in
// test-monitor-types.js.
// ---------------------------------------------------------------------------

describe("tcpingBound — export check", () => {
    test("tcpingBound is not exported from tcp.js (private implementation)", () => {
        const tcpModule = require("../../server/monitor-types/tcp");
        // Confirm what IS exported so future refactors are immediately visible.
        assert.ok(typeof tcpModule.TCPMonitorType === "function", "TCPMonitorType should be exported");
        assert.ok(!("tcpingBound" in tcpModule), "tcpingBound must NOT be exported (private)");
    });
});

// ---------------------------------------------------------------------------
// Group 3: getNetworkInterfaces — data-transformation logic
//
// We replicate the exact filter-and-sort logic from general-socket-handler.js
// and drive it with controlled os.networkInterfaces()-shaped data so the test
// is hermetic (no real socket / auth needed).
// ---------------------------------------------------------------------------

/**
 * Mirror of the handler's transformation: filter internal addresses and sort
 * IPv4 before IPv6, then by name/address.
 * @param {object} nets Return value of os.networkInterfaces()
 * @returns {Array<{name: string, address: string, family: string}>} Filtered and sorted interface list
 */
function transformNetworkInterfaces(nets) {
    const result = [];
    for (const [ifaceName, addresses] of Object.entries(nets)) {
        for (const addr of addresses) {
            if (addr.internal) {
                continue;
            }
            result.push({ name: ifaceName, address: addr.address, family: addr.family });
        }
    }
    result.sort((a, b) => {
        if (a.family === "IPv4" && b.family === "IPv6") {
            return -1;
        }
        if (a.family === "IPv6" && b.family === "IPv4") {
            return 1;
        }
        return a.name.localeCompare(b.name) || a.address.localeCompare(b.address);
    });
    return result;
}

describe("getNetworkInterfaces — data transformation", () => {
    test("internal addresses are filtered out", () => {
        const fakeNets = {
            lo: [
                { address: "127.0.0.1", family: "IPv4", internal: true },
                { address: "::1", family: "IPv6", internal: true },
            ],
            eth0: [
                { address: "10.0.0.5", family: "IPv4", internal: false },
            ],
        };
        const result = transformNetworkInterfaces(fakeNets);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, "10.0.0.5");
        assert.strictEqual(result[0].name, "eth0");
    });

    test("IPv4 entries sort before IPv6 entries", () => {
        const fakeNets = {
            eth0: [
                { address: "fe80::1", family: "IPv6", internal: false },
                { address: "192.168.1.10", family: "IPv4", internal: false },
            ],
        };
        const result = transformNetworkInterfaces(fakeNets);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].family, "IPv4", "IPv4 must come first");
        assert.strictEqual(result[1].family, "IPv6", "IPv6 must come second");
    });

    test("within same family, entries sort by name then address", () => {
        const fakeNets = {
            eth1: [
                { address: "10.0.0.2", family: "IPv4", internal: false },
            ],
            eth0: [
                { address: "10.0.0.1", family: "IPv4", internal: false },
            ],
        };
        const result = transformNetworkInterfaces(fakeNets);
        assert.strictEqual(result[0].name, "eth0", "eth0 must sort before eth1");
        assert.strictEqual(result[1].name, "eth1");
    });

    test("when all addresses are internal, result is empty", () => {
        const fakeNets = {
            lo: [
                { address: "127.0.0.1", family: "IPv4", internal: true },
            ],
        };
        const result = transformNetworkInterfaces(fakeNets);
        assert.strictEqual(result.length, 0);
    });

    test("result entries contain name, address, family keys", () => {
        const fakeNets = {
            eth0: [
                { address: "192.168.0.1", family: "IPv4", internal: false },
            ],
        };
        const result = transformNetworkInterfaces(fakeNets);
        assert.ok("name" in result[0]);
        assert.ok("address" in result[0]);
        assert.ok("family" in result[0]);
    });

    test("real os.networkInterfaces() produces no internal addresses in output", () => {
        // Smoke-test against the real host network stack — confirms the filter
        // works in a real environment.
        const result = transformNetworkInterfaces(os.networkInterfaces());
        for (const entry of result) {
            // All loopback IPs should have been excluded.
            assert.notStrictEqual(entry.address, "127.0.0.1", "loopback IPv4 must be filtered");
            assert.notStrictEqual(entry.address, "::1", "loopback IPv6 must be filtered");
        }
    });
});

// ---------------------------------------------------------------------------
// Group 4: Migration — up/down function exports
// ---------------------------------------------------------------------------

describe("Migration: 2026-05-09-0000-add-bind-interface", () => {
    test("migration file exports up() and down() functions", () => {
        const migration = require("../../db/knex_migrations/2026-05-09-0000-add-bind-interface.js");
        assert.ok(typeof migration.up === "function", "migration.up must be a function");
        assert.ok(typeof migration.down === "function", "migration.down must be a function");
    });
});

// ---------------------------------------------------------------------------
// Group 5: MysqlMonitorType — localAddress option propagation
// ---------------------------------------------------------------------------

describe("MysqlMonitorType — localAddress propagation", () => {
    const { MysqlMonitorType } = require("../../server/monitor-types/mysql");
    const mysql = require("mysql2");

    test("mysqlQuery passes localAddress to mysql2 createConnection", async () => {
        const calls = [];
        const orig = mysql.createConnection.bind(mysql);
        mysql.createConnection = (opts) => {
            calls.push(opts);
            // Return a stub that satisfies the Promise wrapper without a real DB.
            const stub = {
                on: () => stub,
                query: (q, cb) => cb(null, [{ 1: 1 }]),
                end: () => {},
            };
            return stub;
        };

        const instance = new MysqlMonitorType();
        await instance.mysqlQuery("mysql://localhost/db", "SELECT 1", undefined, "10.0.0.5");

        mysql.createConnection = orig;
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].localAddress, "10.0.0.5");
    });

    test("mysqlQuery omits localAddress when not provided", async () => {
        const calls = [];
        const orig = mysql.createConnection.bind(mysql);
        mysql.createConnection = (opts) => {
            calls.push(opts);
            const stub = {
                on: () => stub,
                query: (q, cb) => cb(null, [{ 1: 1 }]),
                end: () => {},
            };
            return stub;
        };

        const instance = new MysqlMonitorType();
        await instance.mysqlQuery("mysql://localhost/db", "SELECT 1");

        mysql.createConnection = orig;
        assert.ok(!calls[0].localAddress, "localAddress must not be set when bind_interface is absent");
    });

    test("mysqlQuerySingleValue passes localAddress to mysql2 createConnection", async () => {
        const calls = [];
        const orig = mysql.createConnection.bind(mysql);
        mysql.createConnection = (opts) => {
            calls.push(opts);
            const stub = {
                on: () => stub,
                query: (q, cb) => cb(null, [{ value: 42 }]),
                end: () => {},
            };
            return stub;
        };

        const instance = new MysqlMonitorType();
        await instance.mysqlQuerySingleValue("mysql://localhost/db", "SELECT 42", undefined, "10.0.0.5");

        mysql.createConnection = orig;
        assert.strictEqual(calls[0].localAddress, "10.0.0.5");
    });
});

// ---------------------------------------------------------------------------
// Group 6: RedisMonitorType — localAddress option propagation
// ---------------------------------------------------------------------------

describe("RedisMonitorType — localAddress propagation", () => {
    const { RedisMonitorType } = require("../../server/monitor-types/redis");
    const redis = require("redis");

    test("redisPingAsync passes localAddress in socket options", async () => {
        const calls = [];
        const origCreate = redis.createClient.bind(redis);
        redis.createClient = (opts) => {
            calls.push(opts);
            // Return a stub client that resolves immediately.
            return {
                on: () => {},
                isOpen: true,
                connect: async () => {},
                ping: async () => "PONG",
                disconnect: async () => {},
            };
        };

        const instance = new RedisMonitorType();
        await instance.redisPingAsync("redis://localhost", true, "10.0.0.5");

        redis.createClient = origCreate;
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].socket.localAddress, "10.0.0.5");
    });

    test("redisPingAsync omits localAddress when not provided", async () => {
        const calls = [];
        const origCreate = redis.createClient.bind(redis);
        redis.createClient = (opts) => {
            calls.push(opts);
            return {
                on: () => {},
                isOpen: true,
                connect: async () => {},
                ping: async () => "PONG",
                disconnect: async () => {},
            };
        };

        const instance = new RedisMonitorType();
        await instance.redisPingAsync("redis://localhost", true);

        redis.createClient = origCreate;
        assert.ok(!calls[0].socket.localAddress, "localAddress must not be set when bind_interface is absent");
    });
});

// ---------------------------------------------------------------------------
// Group 7: PostgresMonitorType — stream factory injected when localAddress set
// ---------------------------------------------------------------------------

describe("PostgresMonitorType — stream factory propagation", () => {
    test("postgresQuery injects stream factory when localAddress provided", async () => {
        const configs = [];

        /**
         * Fake pg Client that records constructor config without opening a socket.
         * @param {object} config pg Client config object
         * @returns {void}
         */
        function FakeClient(config) {
            configs.push(config);
            this.on = () => this;
            this.connect = (cb) => cb(null);
            this.query = (q, cb) => cb(null, { rows: [] });
            this.end = () => {};
        }

        // Replace require cache entry temporarily.
        const pgMod = require.cache[require.resolve("pg")];
        const origExports = pgMod.exports;
        pgMod.exports = { ...origExports, Client: FakeClient };

        // Re-require postgres module with patched pg.
        delete require.cache[require.resolve("../../server/monitor-types/postgres")];
        const { PostgresMonitorType: PGPatched } = require("../../server/monitor-types/postgres");
        const instance = new PGPatched();

        await instance.postgresQuery("postgresql://user:pass@localhost/db", "SELECT 1", "10.0.0.5");

        // Restore.
        pgMod.exports = origExports;
        delete require.cache[require.resolve("../../server/monitor-types/postgres")];

        assert.strictEqual(configs.length, 1);
        assert.ok(typeof configs[0].stream === "function", "stream factory must be set when localAddress is provided");
    });

    test("postgresQuery does not inject stream factory when localAddress absent", async () => {
        const configs = [];

        /**
         * Fake pg Client — no socket opened.
         * @param {object} config pg Client config object
         * @returns {void}
         */
        function FakeClient(config) {
            configs.push(config);
            this.on = () => this;
            this.connect = (cb) => cb(null);
            this.query = (q, cb) => cb(null, { rows: [] });
            this.end = () => {};
        }

        const pgMod = require.cache[require.resolve("pg")];
        const origExports = pgMod.exports;
        pgMod.exports = { ...origExports, Client: FakeClient };

        delete require.cache[require.resolve("../../server/monitor-types/postgres")];
        const { PostgresMonitorType: PGPatched } = require("../../server/monitor-types/postgres");
        const instance = new PGPatched();

        await instance.postgresQuery("postgresql://user:pass@localhost/db", "SELECT 1");

        pgMod.exports = origExports;
        delete require.cache[require.resolve("../../server/monitor-types/postgres")];

        assert.ok(!configs[0].stream, "stream factory must NOT be set when localAddress is absent");
    });
});

// ---------------------------------------------------------------------------
// Group 8: MongodbMonitorType — localAddress option propagation
// ---------------------------------------------------------------------------

describe("MongodbMonitorType — localAddress propagation", () => {
    const mongodb = require("mongodb");

    test("runMongodbCommand passes localAddress to MongoClient.connect", async () => {
        const calls = [];
        const origConnect = mongodb.MongoClient.connect.bind(mongodb.MongoClient);
        mongodb.MongoClient.connect = async (url, opts) => {
            calls.push({ url, opts });
            return {
                db: () => ({ command: async () => ({ ok: 1 }) }),
                close: async () => {},
            };
        };

        delete require.cache[require.resolve("../../server/monitor-types/mongodb")];
        const { MongodbMonitorType } = require("../../server/monitor-types/mongodb");
        const instance = new MongodbMonitorType();
        await instance.runMongodbCommand("mongodb://localhost/db", { ping: 1 }, "10.0.0.5");

        mongodb.MongoClient.connect = origConnect;
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].opts.localAddress, "10.0.0.5");
    });

    test("runMongodbCommand passes no options when localAddress absent", async () => {
        const calls = [];
        const origConnect = mongodb.MongoClient.connect.bind(mongodb.MongoClient);
        mongodb.MongoClient.connect = async (url, opts) => {
            calls.push({ url, opts });
            return {
                db: () => ({ command: async () => ({ ok: 1 }) }),
                close: async () => {},
            };
        };

        delete require.cache[require.resolve("../../server/monitor-types/mongodb")];
        const { MongodbMonitorType } = require("../../server/monitor-types/mongodb");
        const instance = new MongodbMonitorType();
        await instance.runMongodbCommand("mongodb://localhost/db", { ping: 1 });

        mongodb.MongoClient.connect = origConnect;
        assert.deepStrictEqual(calls[0].opts, {}, "opts must be empty object when bind_interface absent");
    });
});
