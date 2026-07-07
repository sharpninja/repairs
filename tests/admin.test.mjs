// Unit tests for the backend admin dashboard (auth gate + rendering, no network).
//   node tests/admin.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "repairs-admin-"));
process.env.MODERATION_LOG_STORE = join(dir, "moderation.jsonl");
process.env.CLIENT_ERRORS_STORE = join(dir, "client-errors.jsonl");
process.env.BANS_STORE = join(dir, "bans.json");
process.env.ADMIN_TOKEN = "s3cret";
// Seed each store. The error message carries a <script> to prove HTML-escaping.
writeFileSync(process.env.MODERATION_LOG_STORE, JSON.stringify({ ts: "2026-01-01", prNumber: 7, decision: "reject", summary: "dangerous advice", submitter: "mod@example.com" }) + "\n");
writeFileSync(process.env.CLIENT_ERRORS_STORE, JSON.stringify({ ts: 1, context: "render", message: "boom <script>alert(1)</script>", route: "home" }) + "\n");
writeFileSync(process.env.BANS_STORE, JSON.stringify([{ email: "banned@example.com", ts: "2026-01-01", reason: "prompt-injection", prNumber: 9 }]));

const { adminHandler } = await import("../server/src/admin.js");

let pass = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };
function mockRes() { return { statusCode: 0, headers: {}, body: "", writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ""; } }; }
async function call(req) { const res = mockRes(); await adminHandler(req, res); return res; }

console.log("admin.js — dashboard auth + rendering");
{ const r = await call({ method: "GET", url: "/admin", headers: {} }); t("no token -> 401", r.statusCode === 401); t("401 body leaks no store data", !/banned@example.com/.test(r.body)); }
{ const r = await call({ method: "GET", url: "/admin?token=wrong", headers: {} }); t("wrong token -> 401", r.statusCode === 401); }
{ const saved = process.env.ADMIN_TOKEN; delete process.env.ADMIN_TOKEN; const r = await call({ method: "GET", url: "/admin", headers: {} }); t("ADMIN_TOKEN unset -> 404 (feature disabled)", r.statusCode === 404); process.env.ADMIN_TOKEN = saved; }
{
  const r = await call({ method: "GET", url: "/admin?token=s3cret", headers: {} });
  t("valid token -> 200 text/html", r.statusCode === 200 && /text\/html/.test(r.headers["content-type"] || ""));
  t("dashboard shows the moderation verdict", /dangerous advice/.test(r.body) && /reject/i.test(r.body));
  t("dashboard shows the error log", /boom/.test(r.body) && /render/.test(r.body));
  t("dashboard shows the ban", /banned@example.com/.test(r.body));
  t("stored <script> is HTML-escaped (no raw injection)", /&lt;script&gt;/.test(r.body) && !/<script>alert/.test(r.body));
  t("renders despite no GitHub creds (best-effort PR section)", r.statusCode === 200);
}
{ const r = await call({ method: "GET", url: "/admin", headers: { "x-admin-token": "s3cret" } }); t("X-Admin-Token header also authorizes", r.statusCode === 200); }

console.log(`\n${pass} assertions passed.`);
