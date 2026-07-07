// Top-level REDIRECT Google sign-in — works with NO third-party storage/cookies, so
// it survives browser tracking prevention (Edge/Safari) and installed standalone PWAs
// where the GIS popup flow silently closes.
//
// Flow: the app renders the GIS button with ux_mode:"redirect" and login_uri pointing
// here. Clicking it navigates the page (top-level, first-party) to Google; Google POSTs
// the ID-token credential (form-urlencoded) + a g_csrf_token double-submit cookie to
// POST /auth/google/callback. We verify both, mint a session, and 303-redirect the
// browser back INTO the PWA scope with a single-use handoff code in the URL *fragment*
// (never a query string, so it never reaches a server log). The app immediately swaps
// that code for its session key via POST /auth/google/redeem, then scrubs it from the URL.
import { randomBytes } from "node:crypto";
import { getStrategy } from "./auth/index.js";
import { createSession } from "./session.js";

// The in-scope PWA URL to return to (must be inside the manifest scope so an installed
// standalone window reclaims the navigation instead of stranding the user in a tab).
const APP_ORIGIN = process.env.APP_ORIGIN || "https://sharpninja.github.io/repairs/";
const DEFAULT_TTL = Number(process.env.HANDOFF_TTL_MS || 120000); // single-use codes live ~2 min
const MAX_BODY = 16 * 1024;

// Single-use, short-lived handoff codes: code -> { session, until }. In-memory, single
// process (same constraint as session.js); GC'd on every access.
const _handoffs = new Map();
function gc(now) { for (const [k, v] of _handoffs) if (!v || v.until <= now) _handoffs.delete(k); }

export function putHandoff(session, ttlMs = DEFAULT_TTL) {
  const now = Date.now(); gc(now);
  const code = randomBytes(24).toString("base64url");
  _handoffs.set(code, { session, until: now + Math.max(1, Number(ttlMs) || DEFAULT_TTL) });
  return code;
}
export function takeHandoff(code) {
  const now = Date.now(); gc(now);
  const rec = code && _handoffs.get(code);
  if (!rec) return null;
  _handoffs.delete(code);            // single-use: consume on read
  if (rec.until <= now) return null; // expired
  return rec.session;
}

// Test seam: stub the Google verifier so unit tests never touch the network.
let _verify = null;
export function __setVerifyForTest(fn) { _verify = fn; }
export function __resetForTest() { _verify = null; _handoffs.clear(); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { try { req.destroy(); } catch (e) {} reject(new Error("body too large")); return; } data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function cookieVal(req, name) {
  const h = req.headers && req.headers.cookie; if (!h) return "";
  for (const part of h.split(";")) { const i = part.indexOf("="); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return "";
}
// 303 (See Other) makes the browser re-issue the return as a GET, dropping the POST body.
function seeOther(res, url) { res.writeHead(303, { Location: url }); res.end(); }

// POST /auth/google/callback — GIS ux_mode:"redirect" target. Top-level browser POST,
// Content-Type application/x-www-form-urlencoded, body: credential, g_csrf_token, select_by.
export async function handleGoogleCallback(req, res) {
  try {
    const form = new URLSearchParams(await readBody(req));
    const credential = form.get("credential") || "";
    const bodyCsrf = form.get("g_csrf_token") || "";
    const cookieCsrf = cookieVal(req, "g_csrf_token");
    // Double-submit-cookie CSRF check FIRST (GIS does not enforce it server-side).
    if (!bodyCsrf || !cookieCsrf || bodyCsrf !== cookieCsrf) {
      res.writeHead(400, { "content-type": "text/plain" }); res.end("Bad sign-in request"); return;
    }
    const verify = _verify || getStrategy("google").verify;
    const user = await verify(credential);            // throws on an invalid / forged token
    const s = createSession(user.email, user.name);   // same session model as StartSession
    const code = putHandoff({ sessionKey: s.key, email: s.email, expiresAt: String(s.exp) });
    seeOther(res, APP_ORIGIN + "#authcode=" + code);
  } catch (e) {
    // Never leak details; bounce back into the app with a generic error flag it can show.
    try { seeOther(res, APP_ORIGIN + "#autherror=1"); } catch (_) {}
  }
}

// POST /auth/google/redeem — the app swaps a single-use handoff code for its session key.
// Cross-origin fetch from the PWA (the server.js CORS shim already covers it).
export async function handleGoogleRedeem(req, res) {
  try {
    let body = {}; const raw = await readBody(req); try { body = raw ? JSON.parse(raw) : {}; } catch (e) {}
    const session = takeHandoff(String(body.code || ""));
    if (!session) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "Invalid or expired sign-in code" })); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sessionKey: session.sessionKey, email: session.email, expiresAt: session.expiresAt }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "error" }));
  }
}
