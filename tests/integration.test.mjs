// Integration tests for ALL client<->server interactions in docs/index.html.
// Serves the app over http and mocks every external endpoint: the Anthropic API,
// the submit/gRPC backend (StartSession/RefreshSession/Submit*/GetSubmissionStatus),
// Google Identity Services, and Notifications.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tests/integration.test.mjs
// (or `npm i -D playwright` and run with node)
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// Resolve playwright from the local install or a NODE_PATH global (ESM import
// ignores NODE_PATH, so go through require).
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const DOCS = path.resolve("docs");
const CHROME = "/opt/pw-browsers/chromium";

const server = http.createServer((req, res) => {
  let f = path.join(DOCS, decodeURIComponent(req.url.split("?")[0]));
  if (f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "text/html" });
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

// A fake JWT with a verified email, so the client can display the account.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const FAKE_JWT = "h." + b64u({ email: "tester@example.com", email_verified: true }) + ".s";

const initScript = ({ jwt, seedSession, seedSubmission }) => `
  // ---- pre-seed app state so boot-time session negotiation + polling run ----
  localStorage.setItem("crvapp1", JSON.stringify({
    apiKey: "sk-test", model: "claude-sonnet-5", activeGuide: "crv-s1",
    submitApi: "https://backend.example.com", googleClientId: "cid.apps.googleusercontent.com",
    dataUrl: "./marketplace.json"   // read the local seed in tests (not the remote approved branch)
  }));
  ${seedSession ? `localStorage.setItem("crv-session", JSON.stringify({ key: "old-key", email: "tester@example.com", exp: Date.now() + 3600000 }));` : ""}
  ${seedSubmission ? `localStorage.setItem("crv-submissions", JSON.stringify([{ number: 7, url: "", title: "My guide", kind: "repair", ts: 1, merged: false, state: "open", notified: false }]));` : ""}

  // ---- Notifications: pretend not granted (client falls back to in-app toast) ----
  window.__notes = [];

  // ---- Fake Google Identity Services ----
  window.google = { accounts: { id: {
    _cb: null,
    initialize(o) { this._cb = o.callback; },
    renderButton(el) { el.innerHTML = '<button id="fakeG">Sign in with Google</button>'; el.querySelector("#fakeG").onclick = () => this._cb && this._cb({ credential: ${JSON.stringify(jwt)} }); },
    prompt() {}
  } } };

  // ---- Mock every network call ----
  window.__rpc = {};
  const realFetch = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    // Submit/gRPC backend
    if (u.includes("/repairs.v1.SubmissionService/")) {
      const method = u.split("/").pop();
      const body = JSON.parse((o && o.body) || "{}");
      window.__rpc[method] = body;
      const J = (obj) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });
      if (method === "StartSession")   return J({ sessionKey: "sess-abc", email: "tester@example.com", expiresAt: String(Date.now() + 3600000) });
      if (method === "RefreshSession") return J({ sessionKey: "sess-rot", email: "tester@example.com", expiresAt: String(Date.now() + 3600000) });
      if (method === "SubmitReview")   return J({ ok: true, prUrl: "https://github.com/x/y/pull/11", prNumber: 11, message: "Review PR opened" });
      if (method === "SubmitRepair")   return J({ ok: true, prUrl: "", prNumber: 0, message: "Submission received" }); // silent-drop shape
      if (method === "GetSubmissionStatus") return J({ statuses: [{ number: 7, state: "closed", merged: true, url: "https://github.com/x/y/pull/7", title: "My guide" }] });
      return J({});
    }
    // Anthropic API — branch on the system prompt
    if (u.includes("api.anthropic.com")) {
      const body = JSON.parse(o.body); const sys = body.system || "";
      window.__anthropic = window.__anthropic || []; window.__anthropic.push({ model: body.model, sys: sys.slice(0, 60), hasKey: !!(o.headers && o.headers["x-api-key"]) });
      const text = (t) => Promise.resolve({ ok: true, json: () => Promise.resolve({ content: [{ type: "text", text: t }], stop_reason: "end_turn" }) });
      const GUIDE = JSON.stringify({ title: "Test Guide", subtitle: "x", region: "us", env: ["garage"], fits: { makes: ["Test"], models: ["T"], yearFrom: 2010, yearTo: 2020 }, phases: [{ name: "P1", steps: [{ t: "s", body: [{ type: "check", items: ["a"] }] }] }], tools: [{ id: "jack-and-stands" }], parts: [{ g: "G", items: [{ n: "part", q: "q" }] }] });
      if (/MERGING several existing guides/.test(sys)) return text(GUIDE);
      if (/generate structured DIY vehicle repair guides/.test(sys)) return text(GUIDE);
      if (/read VIN numbers/.test(sys)) return text("5J6RW2H50JL000000");
      if (/decode vehicle VINs/.test(sys)) return text('{"year":2018,"make":"Honda","model":"CR-V"}');
      return text("Here is your answer.");
    }
    return realFetch(u, o);
  };
`;

// ============ Scenario 1: boot-time session negotiation + PR-status notify ============
{
  console.log("client<->server: startup session negotiation + PR-live notify");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedSession: true, seedSubmission: true }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    refreshCalled: !!window.__rpc.RefreshSession,
    rotatedKey: JSON.parse(localStorage.getItem("crv-session")).key,
    statusCalled: !!window.__rpc.GetSubmissionStatus,
    subMerged: JSON.parse(localStorage.getItem("crv-submissions"))[0].merged,
    subNotified: JSON.parse(localStorage.getItem("crv-submissions"))[0].notified,
    toast: document.querySelector(".toastitem") ? document.querySelector(".toastitem").textContent : "",
  }));
  check("RefreshSession negotiated on startup", r.refreshCalled);
  eq("session key rotated to server's new key", r.rotatedKey, "sess-rot");
  check("GetSubmissionStatus polled on startup", r.statusCalled);
  check("submission marked merged after poll", r.subMerged === true);
  check("submission marked notified", r.subNotified === true);
  check("live toast shown to user", /live in the marketplace/.test(r.toast));
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 2: all other interactions (fresh, logged-out) ============
{
  console.log("client<->server: Anthropic, marketplace, session-tagged submissions");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedSession: false, seedSubmission: false }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  // -- Anthropic: marketplace catalog fetch (real), Ask Claude, New Repair, Merge, VIN OCR/decode --
  const a = await page.evaluate(async () => {
    const R = {};
    const cat = await loadMarket(); R.catalogGuides = cat.guides.length; // real fetch of ./marketplace.json

    chatHistory = []; pushUser("How tight is the ECT2 sensor?"); await completeClaude("");
    R.chatAnswer = chatHistory[chatHistory.length - 1].content[0].text;

    const g1 = await genGuideJSON(SCHEMA_SYSTEM, "make a brake guide"); R.newRepairTitle = g1.title;
    const g2 = await genGuideJSON(MERGE_SYSTEM, "merge these"); R.mergeOk = !!g2.title;

    R.ocr = await ocrVinWithClaude("data:image/jpeg;base64,AAAA");
    R.decode = await decodeVinWithClaude("5J6RW2H50JL000000");

    const systems = (window.__anthropic || []).map((x) => x.sys);
    return Object.assign(R, { systems, allHadKey: (window.__anthropic || []).every((x) => x.hasKey) });
  });
  check("marketplace.json fetched (>=3 guides)", a.catalogGuides >= 3);
  check("Ask Claude round-trips an answer", /your answer/.test(a.chatAnswer));
  eq("New Repair parses a generated guide", a.newRepairTitle, "Test Guide");
  check("Merge round-trips a guide", a.mergeOk);
  eq("VIN OCR returns a VIN", a.ocr, "5J6RW2H50JL000000");
  eq("VIN decode returns fields", a.decode, { year: 2018, make: "Honda", model: "CR-V" });
  check("all Anthropic calls carry the API key header", a.allHadKey);

  // -- Session-tagged review submission via the real UI flow --
  const rev = await page.evaluate(async () => {
    const cat = await loadMarket();
    openMarketGuide(cat.guides[0]);
    await new Promise((r) => setTimeout(r, 60));
    document.querySelectorAll("#myStars .st")[4].click(); // 5 stars
    document.getElementById("revText").value = "Clear and safe.";
    document.getElementById("revPR").click();             // -> submit sheet (no client moderation now)
    await new Promise((r) => setTimeout(r, 60));
    document.getElementById("fakeG").click();              // Google sign-in -> StartSession
    await new Promise((r) => setTimeout(r, 60));
    document.getElementById("subGo").click();              // -> SubmitReview
    await new Promise((r) => setTimeout(r, 80));
    return {
      startSessionCalled: !!window.__rpc.StartSession,
      review: window.__rpc.SubmitReview,
      status: document.getElementById("subStatus").textContent,
      recorded: JSON.parse(localStorage.getItem("crv-submissions") || "[]"),
    };
  });
  check("StartSession called on sign-in", rev.startSessionCalled);
  check("SubmitReview tagged with the session key", rev.review && rev.review.sessionKey === "sess-abc");
  eq("SubmitReview carries the review fields", [rev.review.guideId, rev.review.stars, rev.review.reviewText], ["mkt-crv-s1", 5, "Clear and safe."]);
  check("opened PR is shown + recorded for polling", /#11/.test(rev.status) && rev.recorded.some((s) => s.number === 11));

  // -- Silent-drop shape (empty prUrl) is handled gracefully, nothing recorded --
  const rep = await page.evaluate(async () => {
    openSubmitRepair(guideById("crv-s1"));
    await new Promise((r) => setTimeout(r, 60));
    // already logged in from the review step -> submit directly
    document.getElementById("subGo").click();
    await new Promise((r) => setTimeout(r, 80));
    return { repair: window.__rpc.SubmitRepair, status: document.getElementById("subStatus").textContent, recorded: JSON.parse(localStorage.getItem("crv-submissions") || "[]").length };
  });
  check("SubmitRepair tagged with the session key", rep.repair && rep.repair.sessionKey === "sess-abc");
  check("empty-PR (silent) response shows 'received', records nothing", /received/i.test(rep.status) && rep.recorded === 1);
  eq("no page errors", errs, []);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} assertions passed.`);
