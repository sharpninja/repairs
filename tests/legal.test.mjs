// Unit tests for the submit service's legal endpoints (/legal/privacy, /legal/terms).
// No network: exercises the handler directly with a mock req/res.
//   node tests/legal.test.mjs
import assert from "node:assert/strict";

const { legalHandler, mdToHtml } = await import("../server/src/legal.js");

let pass = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };
function mockRes() { return { statusCode: 0, headers: {}, body: "", writeHead(c, h) { this.statusCode = c; if (h) Object.assign(this.headers, h); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ""; } }; }
function call(url, method = "GET") { const res = mockRes(); const handled = legalHandler({ method, url, headers: {} }, res); return { res, handled }; }

console.log("legal.js — privacy + terms endpoints");

// Privacy
{
  const { res, handled } = call("/legal/privacy");
  t("/legal/privacy is handled", handled === true);
  t("/legal/privacy -> 200 text/html", res.statusCode === 200 && /text\/html/.test(res.headers["content-type"] || ""));
  t("/legal/privacy is cacheable", /max-age/.test(res.headers["cache-control"] || ""));
  t("privacy renders an HTML document with the title", /<title>[^<]*Privacy/i.test(res.body) && /<h1/i.test(res.body));
  t("privacy describes on-device IndexedDB media (never uploaded)", /IndexedDB/i.test(res.body) && /on-device/i.test(res.body));
  t("privacy describes the user-supplied Anthropic key -> api.anthropic.com", /anthropic/i.test(res.body));
  t("privacy mentions Google Sign-In and Apple Sign In", /Google/i.test(res.body) && /Apple/i.test(res.body));
}

// Terms
{
  const { res, handled } = call("/legal/terms");
  t("/legal/terms is handled", handled === true);
  t("/legal/terms -> 200 text/html", res.statusCode === 200 && /text\/html/.test(res.headers["content-type"] || ""));
  t("terms renders with the title", /<title>[^<]*Terms/i.test(res.body));
  t("terms carry the DIY / not-a-substitute-for-a-professional disclaimer", /not a substitute for a professional/i.test(res.body));
  t("terms disclaim warranty", /no warranty|without warranty|as is/i.test(res.body));
}

// Query string tolerated
{ const { res, handled } = call("/legal/privacy?utm=store"); t("query string tolerated -> 200", handled === true && res.statusCode === 200); }

// Non-legal / wrong-method paths fall through (handler returns false, does not write)
{ const { res, handled } = call("/legal/bogus"); t("unknown /legal path -> not handled", handled === false && res.statusCode === 0); }
{ const { res, handled } = call("/health"); t("non-legal path -> not handled", handled === false); }
{ const { res, handled } = call("/legal/privacy", "POST"); t("non-GET -> not handled", handled === false); }

// Markdown -> HTML converter escapes untrusted markup (defense-in-depth)
{
  const html = mdToHtml("# Hi <script>alert(1)</script>\n\n**bold** and a [link](https://ex.com).");
  t("mdToHtml escapes raw HTML", /&lt;script&gt;/.test(html) && !/<script>alert/.test(html));
  t("mdToHtml renders bold + heading + link", /<strong>bold<\/strong>/.test(html) && /<h1/.test(html) && /<a [^>]*href="https:\/\/ex\.com"/.test(html));
}

console.log(`\n${pass} assertions passed.`);
