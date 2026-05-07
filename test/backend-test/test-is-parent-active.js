// Unit tests for Monitor.isParentActiveFromMap — O-2.
//
// isParentActiveFromMap is a pure synchronous function: given an
// in-memory adjacency map it walks the ancestor chain and returns
// false if any ancestor is inactive. No DB, no mocks needed.

process.env.UPTIME_KUMA_HIDE_LOG = ["info_db", "info_server", "debug_monitor"].join(",");

const { describe, test } = require("node:test");
const assert = require("node:assert");

const Monitor = require("../../server/model/monitor");

/**
 * Build a Map from a plain array of {id, parent, active} rows.
 * @param {Array<{id: number, parent: number|null, active: number}>} rows
 * @returns {Map}
 */
function makeMap(rows) {
    const m = new Map();
    for (const row of rows) {
        m.set(row.id, row);
    }
    return m;
}

describe("Monitor.isParentActiveFromMap (O-2)", () => {

    test("root monitor with no parent is always active", () => {
        const byID = makeMap([
            { id: 1, parent: null, active: 1 },
        ]);
        assert.strictEqual(Monitor.isParentActiveFromMap(1, byID), true);
    });

    test("returns true when all ancestors are active", () => {
        // root(1) → group(2) → leaf(3)
        const byID = makeMap([
            { id: 1, parent: null, active: 1 },
            { id: 2, parent: 1,    active: 1 },
            { id: 3, parent: 2,    active: 1 },
        ]);
        assert.strictEqual(Monitor.isParentActiveFromMap(3, byID), true);
    });

    test("returns false when immediate parent is inactive", () => {
        const byID = makeMap([
            { id: 1, parent: null, active: 1 },
            { id: 2, parent: 1,    active: 0 },
            { id: 3, parent: 2,    active: 1 },
        ]);
        assert.strictEqual(Monitor.isParentActiveFromMap(3, byID), false);
    });

    test("returns false when a grandparent is inactive", () => {
        const byID = makeMap([
            { id: 1, parent: null, active: 0 },   // root inactive
            { id: 2, parent: 1,    active: 1 },
            { id: 3, parent: 2,    active: 1 },
        ]);
        assert.strictEqual(Monitor.isParentActiveFromMap(3, byID), false);
    });

    test("leaf's own active field is not checked (caller responsibility)", () => {
        // isParentActiveFromMap only walks ANCESTORS, not the node itself.
        const byID = makeMap([
            { id: 1, parent: null, active: 1 },
            { id: 2, parent: 1,    active: 1 },
        ]);
        // Monitor 2 is active; parents active → true (own field irrelevant)
        assert.strictEqual(Monitor.isParentActiveFromMap(2, byID), true);
    });

    test("missing monitor entry is treated as having no parent (returns true)", () => {
        // monitorID not in map → current is undefined → parentID is null → loop never runs
        const byID = makeMap([]);
        assert.strictEqual(Monitor.isParentActiveFromMap(99, byID), true);
    });

    test("handles a cycle in parent chain without hanging", () => {
        // 1 → parent: 2, 2 → parent: 1 (malformed, cycle)
        const byID = makeMap([
            { id: 1, parent: 2, active: 1 },
            { id: 2, parent: 1, active: 1 },
        ]);
        // Must return without infinite loop; both active so result is true
        assert.strictEqual(Monitor.isParentActiveFromMap(1, byID), true);
    });

    test("cycle with inactive node returns false before cycle", () => {
        const byID = makeMap([
            { id: 1, parent: 2, active: 1 },
            { id: 2, parent: 3, active: 0 },   // inactive
            { id: 3, parent: 1, active: 1 },   // cycle back
        ]);
        assert.strictEqual(Monitor.isParentActiveFromMap(1, byID), false);
    });

    test("flat list of siblings — each independently checks own ancestors", () => {
        const byID = makeMap([
            { id: 1, parent: null, active: 1 },   // active root
            { id: 2, parent: null, active: 0 },   // inactive root
            { id: 3, parent: 1,    active: 1 },   // child of active root
            { id: 4, parent: 2,    active: 1 },   // child of inactive root
        ]);
        assert.strictEqual(Monitor.isParentActiveFromMap(3, byID), true);
        assert.strictEqual(Monitor.isParentActiveFromMap(4, byID), false);
    });

    test("deep chain with inactive node at depth 5", () => {
        const rows = [];
        for (let i = 1; i <= 10; i++) {
            rows.push({ id: i, parent: i === 1 ? null : i - 1, active: i === 5 ? 0 : 1 });
        }
        const byID = makeMap(rows);
        // Leaf is id=10; ancestor id=5 is inactive → false
        assert.strictEqual(Monitor.isParentActiveFromMap(10, byID), false);
        // Node id=4 has ancestors 3,2,1 — all active → true
        assert.strictEqual(Monitor.isParentActiveFromMap(4, byID), true);
    });
});
