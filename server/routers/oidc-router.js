const express = require("express");
const { Issuer, generators } = require("openid-client");
const cookie = require("cookie");
const cookieSignature = require("cookie-signature");
const { Settings } = require("../settings");
const User = require("../model/user");
const { getKnex } = require("../db");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { log } = require("../../src/util");
const { isSSL } = require("../config");
const { loginRateLimiter } = require("../rate-limiter");

let _oidcClient = null;
let _oidcConfigKey = null;

/**
 * Returns a cached openid-client Client, re-discovering the issuer when settings change.
 * @returns {Promise<import("openid-client").Client>} Configured OIDC client
 */
async function getOidcClient() {
    const issuerUrl = await Settings.get("oidcIssuer");
    const clientId = await Settings.get("oidcClientId");
    const clientSecret = await Settings.get("oidcClientSecret");
    const key = `${issuerUrl}|${clientId}`;
    if (!_oidcClient || _oidcConfigKey !== key) {
        const issuer = await Issuer.discover(issuerUrl);
        _oidcClient = new issuer.Client({
            client_id: clientId,
            client_secret: clientSecret,
            response_types: ["code"],
        });
        _oidcConfigKey = key;
    }
    return _oidcClient;
}

/**
 * Clears the cached OIDC client, forcing re-discovery on the next request.
 * Call this whenever OIDC settings change.
 */
function resetOidcClient() {
    _oidcClient = null;
    _oidcConfigKey = null;
}

const router = express.Router();

router.get("/auth/oidc/start", async (req, res) => { // CodeQL[js/missing-rate-limiting] - rate-limited via loginRateLimiter.pass()
    try {
        if (!await loginRateLimiter.pass(null)) {
            return res.status(429).send("Too many requests");
        }

        const enabled = await Settings.get("oidcEnabled");
        if (!enabled) {
            return res.sendStatus(404);
        }

        const client = await getOidcClient();

        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);

        const trustProxy = await Settings.get("trustProxy");
        const proto = (trustProxy && req.headers["x-forwarded-proto"]) || (isSSL ? "https" : req.protocol);
        const redirectUri = proto + "://" + req.get("host") + "/auth/oidc/callback";

        const authUrl = client.authorizationUrl({
            redirect_uri: redirectUri,
            scope: (await Settings.get("oidcScopes")) || "openid email profile",
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
        });

        const payload = JSON.stringify({ state, nonce, codeVerifier });
        const signed = "s:" + cookieSignature.sign(payload, UptimeKumaServer.getInstance().jwtSecret);

        res.setHeader("Set-Cookie", cookie.serialize("oidc_state", signed, {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 600,
            path: "/",
            secure: isSSL || proto === "https",
        }));

        res.redirect(authUrl);
    } catch (e) {
        log.error("oidc", e);
        res.status(503).send("OIDC discovery failed");
    }
});

router.get("/auth/oidc/callback", async (req, res) => { // CodeQL[js/missing-rate-limiting] - rate-limited via loginRateLimiter.pass()
    try {
        if (!await loginRateLimiter.pass(null)) {
            return res.redirect("/?oidcError=1");
        }

        const enabled = await Settings.get("oidcEnabled");
        if (!enabled) {
            return res.sendStatus(404);
        }

        const cookies = cookie.parse(req.headers.cookie || "");
        const raw = cookies.oidc_state;

        if (!raw || !raw.startsWith("s:")) {
            return res.redirect("/?oidcError=1");
        }

        const unsigned = cookieSignature.unsign(raw.slice(2), UptimeKumaServer.getInstance().jwtSecret);
        if (!unsigned) {
            return res.redirect("/?oidcError=1");
        }

        const { state, nonce, codeVerifier } = JSON.parse(unsigned);

        if (req.query.state !== state) {
            return res.redirect("/?oidcError=1");
        }

        const trustProxy = await Settings.get("trustProxy");
        const proto = (trustProxy && req.headers["x-forwarded-proto"]) || (isSSL ? "https" : req.protocol);
        const redirectUri = proto + "://" + req.get("host") + "/auth/oidc/callback";

        const client = await getOidcClient();
        const tokenSet = await client.callback(redirectUri, req.query, {
            state,
            nonce,
            code_verifier: codeVerifier,
        });

        const claims = tokenSet.claims();
        const sub = claims.sub;
        const email = claims.email;
        const preferredUsername = claims.preferred_username;

        const knex = getKnex();
        let user = await User.query().where({ oidc_sub: sub }).first();

        if (!user && email) {
            user = await User.query().whereRaw("LOWER(username) = LOWER(?)", [email]).first();
            if (user) {
                await knex("user").where("id", user.id).update({ oidc_sub: sub });
            }
        }

        if (!user) {
            const username = preferredUsername || email || sub;
            await knex("user").insert({ username, password: null, active: true, oidc_sub: sub })
                .onConflict("oidc_sub").ignore();
            user = await User.query().where({ oidc_sub: sub }).first();
        }

        const token = User.createJWT(user, UptimeKumaServer.getInstance().jwtSecret);

        res.setHeader("Set-Cookie", cookie.serialize("oidc_state", "", {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 0,
            path: "/",
            secure: isSSL || proto === "https",
        }));

        res.redirect("/?token=" + encodeURIComponent(token));
    } catch (e) {
        log.error("oidc", e);
        res.redirect("/?oidcError=1");
    }
});

module.exports = router;
module.exports.resetOidcClient = resetOidcClient;
