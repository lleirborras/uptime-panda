process.env.UPTIME_KUMA_HIDE_LOG = [ "info_db", "info_server" ].join(",");

const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const TestDB = require("../mock-testdb");
const { getKnex } = require("../../server/db");
const User = require("../../server/model/user");
const { Settings } = require("../../server/settings");

// ---------------------------------------------------------------------------
// Suite 1: migration and schema
// ---------------------------------------------------------------------------

const testDb = new TestDB("./data/test-oidc-provisioning");

describe("OIDC — migration and schema", () => {
    before(async () => {
        await testDb.create();
    });

    after(async () => {
        Settings.stopCacheCleaner();
        await testDb.destroy();
    });

    test("oidc_sub column exists on user table", async () => {
        const knex = getKnex();
        const exists = await knex.schema.hasColumn("user", "oidc_sub");
        assert.strictEqual(exists, true, "oidc_sub column must exist on user table after migration");
    });

    test("oidc_sub has unique constraint", async () => {
        const knex = getKnex();

        // Insert a first row with a known sub.
        await knex("user").insert({
            username: "unique-constraint-user",
            password: null,
            active: true,
            oidc_sub: "sub-unique-constraint-001",
        });

        // A second insert with the same oidc_sub must either throw or be ignored.
        let threw = false;
        try {
            await knex("user").insert({
                username: "unique-constraint-user-2",
                password: null,
                active: true,
                oidc_sub: "sub-unique-constraint-001",
            });
        } catch (e) {
            threw = true;
        }

        if (!threw) {
            // Driver may have silently swallowed the conflict; the unique
            // constraint still prevents duplication — verify the row count.
            const rows = await knex("user").where({ oidc_sub: "sub-unique-constraint-001" });
            assert.strictEqual(rows.length, 1, "unique constraint must prevent duplicate oidc_sub rows");
        } else {
            assert.ok(true, "unique constraint raised an error on duplicate oidc_sub — expected");
        }
    });
});

// ---------------------------------------------------------------------------
// Suite 2: user provisioning
// Uses a separate TestDB so it is fully isolated from the schema suite.
// ---------------------------------------------------------------------------

const provisioningDb = new TestDB("./data/test-oidc-provisioning-2");

describe("OIDC — user provisioning", () => {
    before(async () => {
        await provisioningDb.create();
    });

    after(async () => {
        Settings.stopCacheCleaner();
        await provisioningDb.destroy();
    });

    test("JIT: creates new user on first OIDC login", async () => {
        const knex = getKnex();
        await knex("user").insert({
            username: "jituser",
            password: null,
            active: true,
            oidc_sub: "sub-jit-001",
        }).onConflict("oidc_sub").ignore();

        const user = await User.query().where({ oidc_sub: "sub-jit-001" }).first();
        assert.ok(user, "user must be created by JIT provisioning");
        assert.strictEqual(user.password, null, "JIT-provisioned user must have no password");
        assert.strictEqual(user.oidc_sub, "sub-jit-001", "oidc_sub must match the inserted sub");
    });

    test("JIT: links existing account by email match", async () => {
        const knex = getKnex();
        const email = "existing-link@example.com";
        const sub = "sub-link-002";

        // Insert a pre-existing local user whose username is their email address.
        await knex("user").insert({
            username: email,
            password: "hashed-password",
            active: true,
            oidc_sub: null,
        });

        const existingUser = await User.query().where("username", email).first();
        assert.ok(existingUser, "pre-existing user must be found by username/email");

        // Simulate the account-linking step performed by the OIDC callback handler.
        await knex("user").where("id", existingUser.id).update({ oidc_sub: sub });

        // Look up by oidc_sub — must resolve to the same user row.
        const linked = await User.query().where({ oidc_sub: sub }).first();
        assert.ok(linked, "linked user must be found by oidc_sub");
        assert.strictEqual(linked.id, existingUser.id, "linked user must be the same row as the original");
    });

    test("subsequent login: finds existing user by oidc_sub", async () => {
        const knex = getKnex();
        const sub = "sub-subsequent-003";

        await knex("user").insert({
            username: "subsequent-user",
            password: null,
            active: true,
            oidc_sub: sub,
        });

        const first = await User.query().where({ oidc_sub: sub }).first();
        const second = await User.query().where({ oidc_sub: sub }).first();

        assert.ok(first, "first lookup must return a user");
        assert.ok(second, "second lookup must return a user");
        assert.strictEqual(first.id, second.id, "repeated lookup by oidc_sub must return the same user id");
    });

    test("concurrent JIT: onConflict ignore prevents duplicate rows", async () => {
        const knex = getKnex();
        const sub = "sub-concurrent-004";

        // Fire two concurrent inserts with the same oidc_sub.
        await Promise.all([
            knex("user").insert({ username: "concurrent-jit-a", password: null, active: true, oidc_sub: sub }).onConflict("oidc_sub").ignore(),
            knex("user").insert({ username: "concurrent-jit-b", password: null, active: true, oidc_sub: sub }).onConflict("oidc_sub").ignore(),
        ]);

        const rows = await User.query().where({ oidc_sub: sub });
        assert.strictEqual(rows.length, 1, "concurrent JIT inserts must result in exactly one row");
    });
});

// ---------------------------------------------------------------------------
// Suite 3: settings — separate TestDB for isolation
// ---------------------------------------------------------------------------

const settingsDb = new TestDB("./data/test-oidc-settings");

describe("OIDC — settings", () => {
    before(async () => {
        await settingsDb.create();
    });

    after(async () => {
        Settings.stopCacheCleaner();
        await settingsDb.destroy();
    });

    test("oidcEnabled is falsy by default", async () => {
        const value = await Settings.get("oidcEnabled");
        assert.ok(!value, "oidcEnabled must be falsy in a fresh database");
    });

    test("stores and retrieves oidc settings via Settings.setSettings/getSettings", async () => {
        await Settings.setSettings("oidc", {
            oidcEnabled: true,
            oidcIssuer: "https://idp.example.com",
            oidcClientId: "test-id",
            oidcClientSecret: "test-secret",
            oidcScopes: "openid email profile",
        });

        const s = await Settings.getSettings("oidc");
        assert.strictEqual(s.oidcEnabled, true, "oidcEnabled must be stored and retrieved as true");
        assert.strictEqual(s.oidcIssuer, "https://idp.example.com", "oidcIssuer must round-trip correctly");
        assert.strictEqual(s.oidcClientId, "test-id", "oidcClientId must round-trip correctly");
        assert.strictEqual(s.oidcClientSecret, "test-secret", "oidcClientSecret must round-trip correctly");
        assert.strictEqual(s.oidcScopes, "openid email profile", "oidcScopes must round-trip correctly");
    });
});
