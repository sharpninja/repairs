// Accessibility test for the standalone guide slideshow (guide/crv-session1.html):
// slide-change announcements (live region) and focus moving to the new active slide.
//   NODE_PATH=/opt/node22/lib/node_modules node tests/slideshow.test.mjs
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const DIR = path.resolve("guide");
const CHROME = "/opt/pw-browsers/chromium";

const server = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(d);
  });
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };
const eq = (name, a, b) => { assert.deepEqual(a, b, `${name} (got ${JSON.stringify(a)})`); console.log("  ✓ " + name); pass++; };

const launchOpts = fs.existsSync(CHROME) ? { executablePath: CHROME } : {};
const browser = await chromium.launch(launchOpts);

console.log("slideshow: #count is a live region; Next moves focus to the new active slide");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/crv-session1.html", { waitUntil: "load" });
  await page.waitForTimeout(150);

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const count = document.getElementById("count");
    const initial = { role: count.getAttribute("role"), live: count.getAttribute("aria-live") };
    const activeAtStart = document.querySelector(".slide.active");
    const focusedAtStart = document.activeElement === activeAtStart;
    document.getElementById("next").click();
    await sleep(30);
    const activeAfterNext = document.querySelector(".slide.active");
    return {
      initial,
      focusedAtStart,
      changedSlide: activeAfterNext !== activeAtStart,
      focusedAfterNext: document.activeElement === activeAfterNext,
      countText: count.textContent,
    };
  });
  check("#count is a polite status region", r.initial.role === "status" && r.initial.live === "polite"); // F47
  check("focus lands on the active slide on load", r.focusedAtStart);
  check("Next actually advances to a different slide", r.changedSlide);
  check("focus moves to the new active slide after Next", r.focusedAfterNext); // F47
  check("#count reflects the new position", /2 \/ /.test(r.countText));
  eq("no page errors", errs, []);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} assertions passed.`);
