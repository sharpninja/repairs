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
writeFileSync(process.env.MODERATION_LOG_STORE, JSON.stringify({ ts: "2026-01-01", prNumber: 7, prUrl: "https://github.com/sharpninja/repairs-data/pull/7", decision: "reject", summary: "dangerous advice", submitter: "mod@example.com" }) + "\n");
writeFileSync(process.env.CLIENT_ERRORS_STORE, JSON.stringify({ ts: 1, context: "render", message: "boom <script>alert(1)</script>", route: "home" }) + "\n");
writeFileSync(process.env.BANS_STORE, JSON.stringify([{ email: "banned@example.com", ts: "2026-01-01", reason: "prompt-injection", prNumber: 9, prUrl: "https://github.com/sharpninja/repairs-data/pull/9" }]));

const { adminHandler, mergeApprovedHandler, renderHtml } = await import("../server/src/admin.js");

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
  t("moderation rows link to the PR", /<a class="pr-link" href="https:\/\/github\.com\/sharpninja\/repairs-data\/pull\/7" target="_blank" rel="noopener noreferrer">#7<\/a>/.test(r.body));
  t("ban rows link to the PR", /<a class="pr-link" href="https:\/\/github\.com\/sharpninja\/repairs-data\/pull\/9" target="_blank" rel="noopener noreferrer">#9<\/a>/.test(r.body));
  t("stored <script> is HTML-escaped (no raw injection)", /&lt;script&gt;/.test(r.body) && !/<script>alert/.test(r.body));
  t("renders despite no GitHub creds (best-effort PR section)", r.statusCode === 200);
  t("page declares a language (WCAG 3.1.1)", /<html[^>]*\blang="en"/.test(r.body));
  t("table headers use scope=\"col\" (WCAG 1.3.1)", /<th scope="col">/.test(r.body));
  t("no forced auto-refresh interrupting a screen-reader/magnifier read (WCAG 2.2.1)", !/http-equiv="refresh"/i.test(r.body));
  t("dashboard has a merge approved button", /<form method="post" action="\/admin\/merge-approved\?token=s3cret"><button type="submit">Merge approved PRs<\/button><\/form>/.test(r.body));
}
{ const r = await call({ method: "GET", url: "/admin", headers: { "x-admin-token": "s3cret" } }); t("X-Admin-Token header also authorizes", r.statusCode === 200); }
{
  let called = false;
  const res = mockRes();
  await mergeApprovedHandler({ method: "POST", url: "/admin/merge-approved?token=s3cret", headers: {} }, res, async () => {
    called = true;
    return [{ status: "merged" }, { status: "failed" }];
  });
  t("merge-approved endpoint calls the merger", called);
  t("merge-approved redirects with counts", res.statusCode === 303 && /\/admin\?token=s3cret&mergeChecked=2&mergeMerged=1&mergeFailed=1/.test(res.headers.location || ""));
}
{
  let called = false;
  const res = mockRes();
  await mergeApprovedHandler({ method: "POST", url: "/admin/merge-approved?token=wrong", headers: {} }, res, async () => {
    called = true;
    return [];
  });
  t("merge-approved rejects bad token", res.statusCode === 401 && !called);
}
{
  const html = renderHtml({
    prs: [{ number: 12, title: "New guide: Clickable", state: "open", verdict: "approve", injection: false }],
    mod: [],
    errs: [],
    bans: [],
  });
  t("open PR rows link the PR number", /<a class="pr-link" href="https:\/\/github\.com\/sharpninja\/repairs-data\/pull\/12" target="_blank" rel="noopener noreferrer">#12<\/a>/.test(html));
  t("open PR rows link the title too", /<a class="pr-link" href="https:\/\/github\.com\/sharpninja\/repairs-data\/pull\/12" target="_blank" rel="noopener noreferrer">New guide: Clickable<\/a>/.test(html));
}

console.log(`\n${pass} assertions passed.`);
