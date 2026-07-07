// Unit tests for top-level REDIRECT Google sign-in (GIS ux_mode:"redirect"):
//   POST /auth/google/callback  — GIS redirect target (form-urlencoded), CSRF + JWT verify, mints session, 303s back with a one-time code
//   POST /auth/google/redeem    — the app swaps the single-use handoff code for its session key
// No network: the Google verifier is stubbed via __setVerifyForTest; the session
// store is a temp file. Run: node tests/redirect.test.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { existsSync, unlinkSync } from "node:fs";

// Isolate the file-backed session store + pin the return origin BEFORE importing oauth.js
// (session.js and oauth.js read these env vars at module load).
const SESS = path.join(os.tmpdir(), "repairs-redirect-sessions-" + process.pid + ".json");
process.env.SESSION_STORE = SESS;
process.env.APP_ORIGIN = "https://app.example.test/repairs/";

const oauth = await import("../server/src/oauth.js");
const { handleGoogleCallback, handleGoogleRedeem, putHandoff, takeHandoff, __setVerifyForTest, __resetForTest } = oauth;

let pass = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };

// Minimal Node http req/res doubles.
function mkReq({ headers = {}, body = "" }) { const r = Readable.from([Buffer.from(body, "utf8")]); r.headers = headers; return r; }
function mkRes() {
  return { statusCode: 0, headers: {}, body: "", ended: false,
    writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); return this; },
    end(s) { if (s != null) this.body += s; this.ended = true; return this; } };
}
const form = (o) => new URLSearchParams(o).toString();
const codeFromLocation = (loc) => { const m = /#authcode=([^&]+)/.exec(loc || ""); return m ? m[1] : ""; };

console.log("redirect sign-in — single-use handoff store");
{
  __resetForTest();
  const code = putHandoff({ sessionKey: "K1", email: "a@b.com", expiresAt: "999" });
  t("putHandoff returns a non-empty code", typeof code === "string" && code.length > 10);
  const s1 = takeHandoff(code);
  t("takeHandoff returns the session once", s1 && s1.sessionKey === "K1" && s1.email === "a@b.com");
  t("takeHandoff is single-use (second take is null)", takeHandoff(code) === null);
  t("unknown code -> null", takeHandoff("nope") === null);
  const short = putHandoff({ sessionKey: "K2" }, 1); // 1ms TTL
  await new Promise((r) => setTimeout(r, 8));
  t("expired code -> null", takeHandoff(short) === null);
}

console.log("\nredirect sign-in — POST /auth/google/callback");
__resetForTest();
__setVerifyForTest(async (cred) => { if (cred !== "good-token") throw new Error("bad token"); return { email: "rider@example.com", name: "Rider", sub: "g-1", provider: "google" }; });

let callbackCode = "";
{
  const req = mkReq({ headers: { cookie: "g_csrf_token=csrf123; other=x" }, body: form({ credential: "good-token", g_csrf_token: "csrf123", select_by: "btn" }) });
  const res = mkRes();
  await handleGoogleCallback(req, res);
  t("valid callback returns a 303 (GET) redirect", res.statusCode === 303);
  t("303 target is the in-scope app origin", (res.headers.Location || "").startsWith("https://app.example.test/repairs/"));
  callbackCode = codeFromLocation(res.headers.Location);
  t("303 carries a one-time code in the URL fragment (not a query string)", callbackCode.length > 10 && !/\?/.test(res.headers.Location));
}
{
  const req = mkReq({ headers: { cookie: "g_csrf_token=csrf123" }, body: form({ credential: "good-token", g_csrf_token: "different" }) });
  const res = mkRes(); await handleGoogleCallback(req, res);
  t("CSRF mismatch (cookie != body) -> 400, no redirect", res.statusCode === 400 && !res.headers.Location);
}
{
  const req = mkReq({ headers: {}, body: form({ credential: "good-token", g_csrf_token: "csrf123" }) });
  const res = mkRes(); await handleGoogleCallback(req, res);
  t("missing CSRF cookie -> 400", res.statusCode === 400);
}
{
  const req = mkReq({ headers: { cookie: "g_csrf_token=csrf123" }, body: form({ credential: "good-token" }) });
  const res = mkRes(); await handleGoogleCallback(req, res);
  t("missing CSRF body token -> 400", res.statusCode === 400);
}
{
  const req = mkReq({ headers: { cookie: "g_csrf_token=csrf123" }, body: form({ credential: "FORGED", g_csrf_token: "csrf123" }) });
  const res = mkRes(); await handleGoogleCallback(req, res);
  t("invalid ID token -> 303 to app with an error flag", res.statusCode === 303 && /#autherror=1/.test(res.headers.Location || ""));
  t("invalid token yields no usable handoff code", codeFromLocation(res.headers.Location) === "");
}

console.log("\nredirect sign-in — POST /auth/google/redeem");
{
  const req = mkReq({ headers: { "content-type": "application/json" }, body: JSON.stringify({ code: callbackCode }) });
  const res = mkRes(); await handleGoogleRedeem(req, res);
  t("redeem returns 200 for a valid code", res.statusCode === 200);
  const out = JSON.parse(res.body || "{}");
  t("redeem returns the minted session key + email", !!out.sessionKey && out.email === "rider@example.com");
}
{
  const req = mkReq({ headers: {}, body: JSON.stringify({ code: callbackCode }) });
  const res = mkRes(); await handleGoogleRedeem(req, res);
  t("redeem is single-use (second redeem -> 401)", res.statusCode === 401);
}
{
  const req = mkReq({ headers: {}, body: JSON.stringify({ code: "unknown-code" }) });
  const res = mkRes(); await handleGoogleRedeem(req, res);
  t("redeem of an unknown code -> 401", res.statusCode === 401);
}

try { if (existsSync(SESS)) unlinkSync(SESS); } catch (e) {}
console.log(`\n${pass} assertions passed.`);
