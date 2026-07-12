// Server-rendered admin dashboard: moderation status (live PRs + persisted log),
// deidentified client error logs, and the ban audit log. Gated by ADMIN_TOKEN
// (X-Admin-Token header or ?token= query). No client JS; auto-refreshes.
import { readModerationLog, listBans, tailJsonl } from "./store.js";
import { listOpenSubmissionPRs, mergeApprovedSubmissionPRs } from "./github.js";

// Read the SAME file the client-error RPC writes (impl.js CLIENT_ERRORS_STORE).
const CLIENT_ERRORS_STORE = process.env.CLIENT_ERRORS_STORE || "/app/data/client-errors.jsonl";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "sharpninja";
const GITHUB_REPO = process.env.GITHUB_REPO || "repairs-data";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const raw = (html) => ({ html });
const cell = (v) => `<td>${v && typeof v === "object" && typeof v.html === "string" ? v.html : esc(Array.isArray(v) ? v.join(", ") : v)}</td>`;

function githubPrUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:" || u.hostname !== "github.com" || !/\/pull\/\d+\/?$/.test(u.pathname)) return "";
    return u.href;
  } catch (e) { return ""; }
}

function prNumber(row) {
  const number = Number(row && (row.number || row.prNumber));
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function prHref(row) {
  const number = prNumber(row);
  return githubPrUrl(row && (row.url || row.prUrl || row.html_url)) ||
    (number ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/pull/${number}` : "");
}

function prAnchor(row, label) {
  const href = prHref(row);
  if (!href) return "";
  return raw(`<a class="pr-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
}

function prLink(row) {
  const number = prNumber(row);
  const label = Number.isInteger(number) && number > 0 ? `#${number}` : "PR";
  return prAnchor(row, label);
}

function prTitle(row) {
  const title = row && row.title ? row.title : "";
  return prHref(row) ? prAnchor(row, title || "Open PR") : title;
}

function tokenFrom(req) {
  const h = req.headers && req.headers["x-admin-token"];
  if (h) return String(h);
  try { return new URL("http://h" + (req.url || "")).searchParams.get("token") || ""; } catch (e) { return ""; }
}

const n = (v) => Math.max(0, Number.parseInt(String(v || "0"), 10) || 0);

function queryFrom(req) {
  try { return new URL("http://h" + (req.url || "")).searchParams; } catch (e) { return new URLSearchParams(); }
}

function authAdmin(req, res) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
  if (!ADMIN_TOKEN) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return false; }
  if (tokenFrom(req) !== ADMIN_TOKEN) { res.writeHead(401, { "content-type": "text/plain" }); res.end("unauthorized"); return false; }
  return true;
}

function mergeApprovedAction(token) {
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `<form method="post" action="/admin/merge-approved${esc(qs)}"><button type="submit">Merge approved PRs</button></form>`;
}

function flashFrom(query) {
  if (query.get("mergeError")) return raw(`<p class="flash error">Merge approved PRs failed: ${esc(query.get("mergeError"))}</p>`);
  if (!query.has("mergeChecked")) return "";
  const checked = n(query.get("mergeChecked"));
  const merged = n(query.get("mergeMerged"));
  const failed = n(query.get("mergeFailed"));
  const cls = failed ? "flash error" : "flash ok";
  return raw(`<p class="${cls}">Merge approved PRs checked ${checked}; merged ${merged}; failed ${failed}.</p>`);
}

function table(cols, rows, getters, empty) {
  if (!rows || !rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const head = cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("");
  const body = rows.slice().reverse().map((r) => `<tr>${getters.map((g) => cell(g(r))).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderHtml({ prs, mod, errs, bans, adminToken = "", flash = "" }) {
  const prSection = prs === null
    ? `<p class="empty">Live GitHub PR status unavailable (no credentials or API error). Persisted moderation log is below.</p>`
    : table(["PR", "Title", "State", "Verdict", "Injection"], prs,
        [(r) => prLink(r), (r) => prTitle(r), (r) => r.state, (r) => r.verdict, (r) => (r.injection ? "yes" : "")],
        "No open submission PRs.");
  const flashHtml = flash && typeof flash === "object" && typeof flash.html === "string" ? flash.html : esc(flash);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI Auto Repairman - admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:14px/1.4 system-ui,Segoe UI,sans-serif;margin:0;background:#0f1115;color:#e8e6e3}
  header{padding:14px 18px;background:#17191d;border-bottom:1px solid #2a2d33;position:sticky;top:0}
  h1{font-size:16px;margin:0} h2{font-size:14px;margin:22px 0 8px;color:#d97757}
  main{padding:0 18px 40px} .empty{color:#8a8d93}
  .actions{display:flex;gap:12px;align-items:center;margin:18px 0 4px}.actions form{margin:0}
  button{background:#d97757;color:#111;border:0;border-radius:6px;padding:7px 10px;font-weight:700;cursor:pointer}
  .flash{margin:0}.flash.ok{color:#78d48f}.flash.error{color:#ff9a8a}
  table{border-collapse:collapse;width:100%;font-size:12.5px} th,td{border:1px solid #2a2d33;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#1c1f24} td{max-width:520px;overflow-wrap:anywhere} tr:nth-child(even) td{background:#141619}
  a.pr-link{color:#8bd3ff;font-weight:650;text-decoration:underline;text-underline-offset:2px} a.pr-link:visited{color:#c7b8ff}
  code{white-space:pre-wrap}
</style></head><body>
<header><h1>AI Auto Repairman - admin dashboard</h1></header>
<main>
  <div class="actions">${mergeApprovedAction(adminToken)}${flashHtml}</div>
  <h2>Moderation status (open submission PRs)</h2>${prSection}
  <h2>Moderation log (${mod.length})</h2>${table(["When", "PR", "Submitter", "Decision", "Sev", "Categories", "Summary"], mod,
    [(r) => r.ts, (r) => prLink(r), (r) => r.submitter, (r) => (r.injection ? "reject (injection)" : r.decision), (r) => r.severity, (r) => r.categories, (r) => r.summary],
    "No moderation recorded yet.")}
  <h2>Error logs (${errs.length}, deidentified)</h2>${table(["When", "Context", "Route", "App", "Message", "Stack"], errs,
    [(r) => new Date(r.receivedAt || r.ts || 0).toISOString(), (r) => r.context, (r) => r.route, (r) => r.appVersion, (r) => r.message, (r) => (r.stack || "").slice(0, 300)],
    "No client errors reported.")}
  <h2>Bans (${bans.length})</h2>${table(["When", "Email", "Reason", "PR", "Verdict summary"], bans,
    [(r) => r.ts, (r) => r.email, (r) => r.reason, (r) => prLink(r), (r) => (r.verdict && r.verdict.summary) || ""],
    "No bans recorded.")}
</main></body></html>`;
}

// GET /admin - token-gated. 404 when ADMIN_TOKEN is unset (feature off),
// 401 on missing/invalid token, else the rendered dashboard.
export async function adminHandler(req, res) {
  if (!authAdmin(req, res)) return;
  const mod = readModerationLog(300);
  const errs = tailJsonl(CLIENT_ERRORS_STORE, 300);
  const bans = listBans();
  let prs = null;
  try { prs = await listOpenSubmissionPRs(); } catch (e) { prs = null; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderHtml({ prs, mod, errs, bans, adminToken: tokenFrom(req), flash: flashFrom(queryFrom(req)) }));
}

// POST /admin/merge-approved - token-gated batch merge for open approved submissions.
export async function mergeApprovedHandler(req, res, mergeApproved = mergeApprovedSubmissionPRs) {
  if (!authAdmin(req, res)) return;
  const token = tokenFrom(req);
  let checked = 0;
  let merged = 0;
  let failed = 0;
  let error = "";
  try {
    const results = await mergeApproved();
    checked = results.length;
    merged = results.filter((r) => r.status === "merged").length;
    failed = results.filter((r) => r.status !== "merged").length;
    const failedResults = results.filter((r) => r.status !== "merged" && r.error);
    if (failedResults.length) {
      error = failedResults.map((r) => `#${r.number || "?"}: ${r.error}`).join("; ").slice(0, 300);
    }
  } catch (e) {
    error = String((e && e.message) || e || "unknown error").slice(0, 300);
  }
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  params.set("mergeChecked", String(checked));
  params.set("mergeMerged", String(merged));
  params.set("mergeFailed", String(failed));
  if (error) params.set("mergeError", error);
  res.writeHead(303, { location: `/admin?${params.toString()}` });
  res.end();
}
