// Unit tests for getAcceptedStatuscodes() instance cache — O-1.
//
// Verifies that the parsed result is cached after the first call and
// that _refreshStaticConfig() invalidates the cache so editMonitor
// changes (stop → start → _refreshStaticConfig) take effect.

process.env.UPTIME_KUMA_HIDE_LOG = ["info_db", "info_server", "debug_monitor"].join(",");

// safeJsonParse calls log.debug unbound; bind it now so this resolves correctly.
const { log } = require("../../src/util");
log.debug = log.debug.bind(log);
log.warn = log.warn.bind(log);

const { describe, test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const ProxyModel = require("../../server/model/proxy");
const DockerHostModel = require("../../server/model/docker_host");
const Monitor = require("../../server/model/monitor");

/**
 * Stub Objection query methods so _refreshStaticConfig() doesn't need a real DB.
 * @returns {Function} Restore function that resets the original query methods.
 */
function stubQueries() {
    const origProxy = ProxyModel.query;
    const origDocker = DockerHostModel.query;
    ProxyModel.query = () => ({ findById: async () => null });
    DockerHostModel.query = () => ({ findById: async () => null });
    return () => {
        ProxyModel.query = origProxy;
        DockerHostModel.query = origDocker;
    };
}

describe("Monitor.getAcceptedStatuscodes() cache (O-1)", () => {
    let restore;

    beforeEach(() => {
        restore = stubQueries();
    });
    afterEach(() => restore());

    test("parses and caches on first call", () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.accepted_statuscodes_json = '["200","201"]';

        const result = monitor.getAcceptedStatuscodes();
        assert.deepStrictEqual(result, ["200", "201"]);
        // Same reference on second call — parsed only once.
        assert.strictEqual(monitor.getAcceptedStatuscodes(), result);
    });

    test("returns default when json is null", () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.accepted_statuscodes_json = null;

        assert.deepStrictEqual(monitor.getAcceptedStatuscodes(), ["200"]);
    });

    test("returns default when json is invalid", () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.accepted_statuscodes_json = "not-json";

        assert.deepStrictEqual(monitor.getAcceptedStatuscodes(), ["200"]);
    });

    test("returns same reference across multiple calls (no re-parse)", () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.accepted_statuscodes_json = '["200"]';

        const a = monitor.getAcceptedStatuscodes();
        const b = monitor.getAcceptedStatuscodes();
        const c = monitor.getAcceptedStatuscodes();
        assert.strictEqual(a, b);
        assert.strictEqual(b, c);
    });

    test("_refreshStaticConfig() invalidates cache so new json takes effect", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.proxy_id = null;
        monitor.docker_host = null;
        monitor.accepted_statuscodes_json = '["200"]';

        const first = monitor.getAcceptedStatuscodes();
        assert.deepStrictEqual(first, ["200"]);

        // Simulate editMonitor updating the field and calling stop → start.
        monitor.accepted_statuscodes_json = '["404","200"]';
        await monitor._refreshStaticConfig();

        const second = monitor.getAcceptedStatuscodes();
        assert.deepStrictEqual(second, ["404", "200"]);
        // Cache re-populated — same ref on subsequent call.
        assert.strictEqual(monitor.getAcceptedStatuscodes(), second);
    });

    test("two monitor instances have independent caches", () => {
        const a = Object.create(Monitor.prototype);
        a.accepted_statuscodes_json = '["200"]';

        const b = Object.create(Monitor.prototype);
        b.accepted_statuscodes_json = '["404"]';

        assert.deepStrictEqual(a.getAcceptedStatuscodes(), ["200"]);
        assert.deepStrictEqual(b.getAcceptedStatuscodes(), ["404"]);
        assert.notStrictEqual(a.getAcceptedStatuscodes(), b.getAcceptedStatuscodes());
    });
});
