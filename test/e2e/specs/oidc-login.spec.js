import { expect, test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { login, restoreSqliteSnapshot } from "../util-test";

// ---------------------------------------------------------------------------
// Gate: skip the entire file unless RUN_OIDC_TESTS=1 is set.
// Spinning up a Dex container takes 30-60 s and requires Docker.
// ---------------------------------------------------------------------------
const RUN_OIDC_TESTS = !!process.env.RUN_OIDC_TESTS;

const DEX_HOST_PORT = 5557;
const DEX_CONTAINER_PORT = 5556;
const APP_URL = "http://localhost:30001";

/**
 * Build the Dex static config. The bcrypt hash below is for "testpassword".
 * @param {string} issuerUrl Full issuer URL including /dex path
 * @returns {string} YAML config string for Dex
 */
function buildDexConfig(issuerUrl) {
    return `issuer: ${issuerUrl}
storage:
  type: memory
web:
  http: 0.0.0.0:${DEX_CONTAINER_PORT}
oauth2:
  skipApprovalScreen: true
staticClients:
  - id: uptime-panda-test
    secret: test-secret
    redirectURIs:
      - ${APP_URL}/auth/oidc/callback
enablePasswordDB: true
staticPasswords:
  - email: oidctest@example.com
    hash: "$2y$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W"
    username: oidctest
    userID: "test-user-id-oidc-001"
`;
}

let dexContainer;
let issuerUrl;

test.beforeAll(async () => {
    if (!RUN_OIDC_TESTS) {
        return;
    }

    const { GenericContainer, Wait } = await import("testcontainers");

    const configDir = path.join(tmpdir(), "dex-test-config");
    mkdirSync(configDir, { recursive: true });

    // Embed the known host port directly in the issuer URL.
    issuerUrl = `http://localhost:${DEX_HOST_PORT}/dex`;
    const configPath = path.join(configDir, "config.yaml");
    writeFileSync(configPath, buildDexConfig(issuerUrl));

    dexContainer = await new GenericContainer("dexidp/dex:v2.41.1")
        .withExposedPorts({ container: DEX_CONTAINER_PORT, host: DEX_HOST_PORT })
        .withBindMounts([{ source: configDir, target: "/etc/dex" }])
        .withCommand(["dex", "serve", "/etc/dex/config.yaml"])
        .withWaitStrategy(Wait.forHttp("/.well-known/openid-configuration", DEX_CONTAINER_PORT))
        .start();
});

test.afterAll(async () => {
    await dexContainer?.stop();
});

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Configure OIDC settings in the UI as admin, then log out.
 * @param {import("@playwright/test").Page} page Playwright page object
 */
async function configureOidc(page) {
    await page.goto("./");
    await login(page);
    await page.goto("./settings/oidc");

    await page.getByLabel("Enable OIDC").check();
    await page.getByLabel("OIDC Issuer URL").fill(issuerUrl);
    await page.getByLabel("OIDC Client ID").fill("uptime-panda-test");
    await page.getByLabel("OIDC Client Secret").fill("test-secret");
    await page.getByLabel("OIDC Scopes").fill("openid email profile");
    await page.getByRole("button", { name: "Save" }).click();

    // Log out so subsequent steps start on the login page.
    await page.getByText("A", { exact: true }).click();
    await page.getByRole("button", { name: "Log out" }).click();
}

// ---------------------------------------------------------------------------
// Test 1: SSO button absent when OIDC is disabled (default state)
// ---------------------------------------------------------------------------
test("OIDC disabled by default - no SSO button on login page", async ({ page }) => {
    test.skip(!RUN_OIDC_TESTS, "Set RUN_OIDC_TESTS=1 to run OIDC integration tests");
    await page.goto("./");
    await expect(page.getByText("Login with SSO")).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 2: Configuring OIDC makes the SSO button appear
// ---------------------------------------------------------------------------
test("configuring OIDC shows SSO button on login page", async ({ page }) => {
    test.skip(!RUN_OIDC_TESTS, "Set RUN_OIDC_TESTS=1 to run OIDC integration tests");
    await configureOidc(page);
    await expect(page.getByText("Login with SSO")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 3: Happy-path OIDC login via Dex
// ---------------------------------------------------------------------------
test("OIDC login - happy path via Dex", async ({ page }) => {
    test.skip(!RUN_OIDC_TESTS, "Set RUN_OIDC_TESTS=1 to run OIDC integration tests");
    await configureOidc(page);

    // Click the SSO login link to start the OIDC flow.
    await page.getByRole("link", { name: "Login with SSO" }).click();

    // Fill in the Dex static-password login form.
    await page.getByPlaceholder("Email Address").fill("oidctest@example.com");
    await page.getByPlaceholder("Password").fill("testpassword");
    await page.getByRole("button", { name: "Log in" }).click();

    // The callback handler issues a JWT and redirects to the dashboard.
    await page.waitForURL(/\/dashboard/);
    await expect(page).toHaveURL(/\/dashboard/);

    // The JWT must be consumed server-side; it must not remain in the URL.
    expect(page.url()).not.toContain("token=");
});

// ---------------------------------------------------------------------------
// Test 4: Callback with a wrong state param is rejected
// ---------------------------------------------------------------------------
test("OIDC callback with wrong state returns oidcError", async ({ page }) => {
    test.skip(!RUN_OIDC_TESTS, "Set RUN_OIDC_TESTS=1 to run OIDC integration tests");
    await page.goto("./auth/oidc/callback?code=fake&state=wrong");
    await expect(page).toHaveURL(/oidcError=1/);
});
