// Unit tests for Monitor.updateTlsInfo — O-3 (perf/tls-info-skip-unchanged-write).
//
// Verifies that updateTlsInfo() skips the DB write when the certificate
// fingerprint is unchanged, and still writes on first check, cert rotation,
// or when the stored info_json is invalid.

process.env.UPTIME_KUMA_HIDE_LOG = ["info_db", "info_server", "debug_monitor"].join(",");

const { describe, test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

// safeJsonParse assigns `log.debug` to a local var and calls it without binding.
// Ensure the Logger methods are bound on the singleton so `this` resolves correctly.
const { log } = require("../../src/util");
log.debug = log.debug.bind(log);
log.warn = log.warn.bind(log);

const dbModulePath = require.resolve("../../server/db");

/**
 * Install a fake getKnex into the require cache and return the Monitor
 * class (re-required so it picks up the fake).
 * @param {Function} fakeGetKnex Function that returns a Knex-like query builder.
 * @returns {Function} Monitor class with faked DB.
 */
function loadMonitorWithFakeDb(fakeGetKnex) {
    // Inject fake into require cache before Monitor loads db.
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: { getKnex: fakeGetKnex },
    };
    const monitorPath = require.resolve("../../server/model/monitor");
    delete require.cache[monitorPath];
    const Monitor = require("../../server/model/monitor");
    return Monitor;
}

/**
 * Build a minimal certInfo result for a given fingerprint.
 * @param {string} fp fingerprint256 value
 * @returns {object} Minimal heartbeat-style result with certInfo.
 */
function certResult(fp) {
    return { valid: true, certInfo: { fingerprint256: fp } };
}

describe("Monitor.updateTlsInfo (O-3 skip-unchanged-write)", () => {
    let originalDbCache;

    beforeEach(() => {
        originalDbCache = require.cache[dbModulePath];
    });

    afterEach(() => {
        // Restore whatever was there before so other tests aren't affected.
        if (originalDbCache) {
            require.cache[dbModulePath] = originalDbCache;
        } else {
            delete require.cache[dbModulePath];
        }
        delete require.cache[require.resolve("../../server/model/monitor")];
    });

    test("inserts row on first check (no existing row)", async () => {
        let insertCalled = false;

        const fakeGetKnex = () => (table) => ({
            where: () => ({ first: async () => null }),          // no existing row
            insert: async (_row) => { insertCalled = true; },
        });

        const Monitor = loadMonitorWithFakeDb(fakeGetKnex);
        const monitor = Object.create(Monitor.prototype);
        monitor.id = 1;

        await monitor.updateTlsInfo(certResult("AA:BB"));

        assert.ok(insertCalled, "insert must be called for a new row");
    });

    test("skips write when fingerprint unchanged", async () => {
        const fp = "AA:BB:CC";
        let updateCalled = false;

        const existingRow = {
            id: 10,
            monitor_id: 1,
            info_json: JSON.stringify(certResult(fp)),
        };

        const fakeGetKnex = () => (table) => ({
            where: (...args) => ({
                first: async () => existingRow,
                update: async (_payload) => { updateCalled = true; },
                delete: async () => {},
            }),
        });

        const Monitor = loadMonitorWithFakeDb(fakeGetKnex);
        const monitor = Object.create(Monitor.prototype);
        monitor.id = 1;

        const result = await monitor.updateTlsInfo(certResult(fp));

        assert.ok(!updateCalled, "update must NOT be called when fingerprint is unchanged");
        assert.deepStrictEqual(result, certResult(fp), "must return the new result object");
    });

    test("writes and clears sent-history on cert rotation (fingerprint changed)", async () => {
        let updateCalled = false;
        let deleteCalled = false;

        const existingRow = {
            id: 10,
            monitor_id: 1,
            info_json: JSON.stringify(certResult("OLD:FP")),
        };

        const fakeGetKnex = () => (table) => ({
            where: (...args) => ({
                first: async () => existingRow,
                update: async (_payload) => { updateCalled = true; },
                delete: async () => { deleteCalled = true; },
            }),
        });

        const Monitor = loadMonitorWithFakeDb(fakeGetKnex);
        const monitor = Object.create(Monitor.prototype);
        monitor.id = 1;

        await monitor.updateTlsInfo(certResult("NEW:FP"));

        assert.ok(updateCalled, "update must be called after cert rotation");
        assert.ok(deleteCalled, "notification_sent_history must be cleared on cert rotation");
    });

    test("writes when existing info_json is invalid JSON", async () => {
        let updateCalled = false;

        const existingRow = {
            id: 10,
            monitor_id: 1,
            info_json: "not-valid-json",
        };

        const fakeGetKnex = () => (table) => ({
            where: (...args) => ({
                first: async () => existingRow,
                update: async (_payload) => { updateCalled = true; },
                delete: async () => {},
            }),
        });

        const Monitor = loadMonitorWithFakeDb(fakeGetKnex);
        const monitor = Object.create(Monitor.prototype);
        monitor.id = 1;

        await monitor.updateTlsInfo(certResult("AA:BB"));

        assert.ok(updateCalled, "update must still be called when stored info_json is unparseable");
    });

    test("writes when new result has no certInfo (non-TLS fallback)", async () => {
        let updateCalled = false;

        const existingRow = {
            id: 10,
            monitor_id: 1,
            info_json: JSON.stringify(certResult("AA:BB")),
        };

        const fakeGetKnex = () => (table) => ({
            where: (...args) => ({
                first: async () => existingRow,
                update: async (_payload) => { updateCalled = true; },
                delete: async () => {},
            }),
        });

        const Monitor = loadMonitorWithFakeDb(fakeGetKnex);
        const monitor = Object.create(Monitor.prototype);
        monitor.id = 1;

        // Result without certInfo — isValidObjects will be false, falls through to write.
        await monitor.updateTlsInfo({ valid: false });

        assert.ok(updateCalled, "update must still be called when new result has no certInfo");
    });
});
