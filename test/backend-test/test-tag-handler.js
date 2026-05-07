// Avoid production-only side effects (process.exit on missing dist/index.html)
// when transitively requiring server bootstrap code via this handler module.
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.UPTIME_KUMA_HIDE_LOG = ["info_server", "info_socket", "info_auth"].join(",");

const { describe, test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
    tagSocketHandler,
} = require("../../server/socket-handlers/tag-socket-handler");

/**
 * Build a mock socket that records every event registered via `socket.on`.
 * @returns {{socket: object, registered: Map<string, Function>}} mock socket and the registry
 */
function buildMockSocket() {
    const registered = new Map();
    const socket = {
        userID: 1,
        on(event, handler) {
            registered.set(event, handler);
        },
    };
    return {
        socket,
        registered,
    };
}

describe("tagSocketHandler", () => {
    test("module exports a function", () => {
        assert.strictEqual(
            typeof tagSocketHandler,
            "function",
            "tagSocketHandler should be exported as a function"
        );
    });

    test("registers the expected events on the socket without throwing", () => {
        const { socket, registered } = buildMockSocket();

        assert.doesNotThrow(() => {
            tagSocketHandler(socket);
        });

        const expectedEvents = [
            "getTags",
            "addTag",
            "editTag",
            "deleteTag",
            "addMonitorTag",
            "editMonitorTag",
            "deleteMonitorTag",
        ];

        for (const event of expectedEvents) {
            assert.ok(
                registered.has(event),
                `Expected event "${event}" to be registered on the socket`
            );
            assert.strictEqual(
                typeof registered.get(event),
                "function",
                `Handler for "${event}" should be a function`
            );
        }
    });

    test("auto-discovery picks up tag-socket-handler.js", () => {
        const handlersDir = path.join(__dirname, "..", "..", "server", "socket-handlers");
        const files = fs.readdirSync(handlersDir)
            .filter((f) => f.endsWith(".js") && !f.startsWith("_"));
        assert.ok(
            files.includes("tag-socket-handler.js"),
            "tag-socket-handler.js must be present so the auto-discovery loop registers it"
        );
    });

    test("unauthenticated socket: handlers reject via callback without throwing", async () => {
        // Mock socket without userID -> checkLogin throws inside onAuthed, which
        // routes the auth error through socketError. The handler body must NOT
        // execute, so we never hit Tag.query().
        const localRegistry = new Map();
        tagSocketHandler({
            on(event, fn) {
                localRegistry.set(event, fn);
            },
        });

        const handler = localRegistry.get("getTags");
        assert.strictEqual(typeof handler, "function");

        const captured = [];
        await new Promise((resolve) => {
            handler((result) => {
                captured.push(result);
                resolve();
            });
        });

        assert.strictEqual(captured.length, 1, "callback should fire exactly once");
        assert.strictEqual(captured[0].ok, false, "unauthenticated call should be rejected");
    });
});
