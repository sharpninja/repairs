// Server-rendered admin dashboard: moderation status (live PRs + persisted log),
// deidentified client error logs, and the ban audit log. Gated by ADMIN_TOKEN
// (X-Admin-Token header or ?token= query). No client JS; auto-refreshes.
import { readModerationLog, listBans, tailJsonl } from "./store.js";
import { listOpenSubmissionPRs } from "./github.js";

// Read the SAME file the client-error RPC writes (impl.js CLIENT_ERRORS_STORE).
const CLIENT_ERRORS_STORE = process.env.CLIENT_ERRORS_STORE || "/app/data/client-errors.jsonl";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cell = (v) => `<td>${esc(Array.isArray(v) ? v.join(", ") : v)}</td>`;

function tokenFrom(req) {
  const h = req.headers && req.headers["x-admin-token"];
  if (h) return String(h);
  try { return new URL("http://h" + (req.url || "")).searchParams.get("token") || ""; } catch (e) { return ""; }
}

function table(cols, rows, getters, empty) {
  if (!rows || !rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.slice().reverse().map((r) => `<tr>${getters.map((g) => cell(g(r))).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderHtml({ prs, mod, errs, bans, token }) {
  const prSection = prs === null
    ? `<p class="empty">Live GitHub PR status unavailable (no credentials or API error). Persisted moderation log is below.</p>`
    : table(["PR", "Title", "State", "Verdict", "Injection"], prs,
        [(r) => `#${r.number}`, (r) => r.title, (r) => r.state, (r) => r.verdict, (r) => (r.injection ? "yes" : "")],
        "No open submission PRs.");
  return `<!doctype html><html><head><meta charset="utf-8"><title>AI Auto Repairman - admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20;url=/admin?token=${encodeURIComponent(token)}">
<style>
  body{font:14px/1.4 system-ui,Segoe UI,sans-serif;margin:0;background:#0f1115;color:#e8e6e3}
  header{padding:14px 18px;background:#17191d;border-bottom:1px solid #2a2d33;position:sticky;top:0}
  h1{font-size:16px;margin:0} h2{font-size:14px;margin:22px 0 8px;color:#d97757}
  main{padding:0 18px 40px} .empty{color:#8a8d93}
  table{border-collapse:collapse;width:100%;font-size:12.5px} th,td{border:1px solid #2a2d33;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#1c1f24} td{max-width:520px;overflow-wrap:anywhere} tr:nth-child(even) td{background:#141619}
  code{white-space:pre-wrap}
</style></head><body>
<header><h1>AI Auto Repairman - admin dashboard</h1></header>
<main>
  <h2>Moderation status (open submission PRs)</h2>${prSection}
  <h2>Moderation log (${mod.length})</h2>${table(["When", "PR", "Submitter", "Decision", "Sev", "Categories", "Summary"], mod,
    [(r) => r.ts, (r) => (r.prNumber ? `#${r.prNumber}` : ""), (r) => r.submitter, (r) => (r.injection ? "reject (injection)" : r.decision), (r) => r.severity, (r) => r.categories, (r) => r.summary],
    "No moderation recorded yet.")}
  <h2>Error logs (${errs.length}, deidentified)</h2>${table(["When", "Context", "Route", "App", "Message", "Stack"], errs,
    [(r) => new Date(r.receivedAt || r.ts || 0).toISOString(), (r) => r.context, (r) => r.route, (r) => r.appVersion, (r) => r.message, (r) => (r.stack || "").slice(0, 300)],
    "No client errors reported.")}
  <h2>Bans (${bans.length})</h2>${table(["When", "Email", "Reason", "PR", "Verdict summary"], bans,
    [(r) => r.ts, (r) => r.email, (r) => r.reason, (r) => (r.prNumber ? `#${r.prNumber}` : ""), (r) => (r.verdict && r.verdict.summary) || ""],
    "No bans recorded.")}
</main></body></html>`;
}

// GET /admin - token-gated. 404 when ADMIN_TOKEN is unset (feature off),
// 401 on missing/invalid token, else the rendered dashboard.
export async function adminHandler(req, res) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
  if (!ADMIN_TOKEN) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
  if (tokenFrom(req) !== ADMIN_TOKEN) { res.writeHead(401, { "content-type": "text/plain" }); res.end("unauthorized"); return; }
  const mod = readModerationLog(300);
  const errs = tailJsonl(CLIENT_ERRORS_STORE, 300);
  const bans = listBans();
  let prs = null;
  try { prs = await listOpenSubmissionPRs(); } catch (e) { prs = null; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderHtml({ prs, mod, errs, bans, token: ADMIN_TOKEN }));
}
