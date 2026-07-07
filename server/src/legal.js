// Serves the store-required legal pages (privacy policy + terms of service) as
// plain HTML over simple GETs. Play Console and App Store Connect need public
// URLs for these during listing setup, so they are meant to be opened directly
// in a browser and are unaffected by the app's CORS allowlist.
//
//   GET /legal/privacy
//   GET /legal/terms
//
// The content lives in server/legal/*.md; a tiny dependency-free Markdown->HTML
// converter renders them (all text is HTML-escaped as defense-in-depth).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = join(HERE, "..", "legal");

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline markup, applied AFTER escaping so raw HTML can never survive: links to
// http(s) only, then **bold**, then `code`.
function inline(s) {
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) => `<a href="${url}" rel="noopener noreferrer">${txt}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

// Minimal block-level Markdown: #/##/### headings, "- "/"* " lists, blank-line
// separated paragraphs. Enough for the hand-written legal docs; not general.
export function mdToHtml(md) {
  const lines = String(md == null ? "" : md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false, para = [];
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const flushPara = () => { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); closeList(); continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flushPara(); closeList(); const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) { flushPara(); if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + inline(m[1]) + "</li>"); continue; }
    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join("\n");
}

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | AI Auto Repairman</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#20201e;background:#faf9f5;margin:0}
  main{max-width:760px;margin:0 auto;padding:36px 22px 72px}
  h1{font-size:1.9em;margin:0 0 .3em} h2{font-size:1.25em;margin:1.7em 0 .3em}
  a{color:#c05f3e} code{background:#f1efe8;padding:1px 6px;border-radius:5px} ul{padding-left:1.2em}
  em{color:#75736c}
</style>
</head><body><main>
${bodyHtml}
</main></body></html>`;
}

const ROUTES = {
  "/legal/privacy": ["Privacy Policy", "privacy.md"],
  "/legal/terms": ["Terms of Service", "terms.md"],
};

// Returns true if it recognized and served the request; false to let the caller
// fall through to the next route. Simple GET, no auth, short cache.
export function legalHandler(req, res) {
  if (req.method !== "GET") return false;
  const path = String(req.url || "").split("?")[0];
  const hit = ROUTES[path];
  if (!hit) return false;
  const [title, file] = hit;
  let md;
  try { md = readFileSync(join(LEGAL_DIR, file), "utf8"); }
  catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("legal document unavailable");
    return true;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
  res.end(page(title, mdToHtml(md)));
  return true;
}
