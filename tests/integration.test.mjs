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

const initScript = ({ jwt, seedSession, seedSubmission, seedVehicles, activeVehicle, cfgTag }) => `
  // ---- pre-seed app state so boot-time session negotiation + polling run ----
  localStorage.setItem("crvapp1", JSON.stringify({
    apiKey: "sk-test", model: "claude-sonnet-5", activeGuide: "crv-s1",
    activeVehicle: ${JSON.stringify(activeVehicle || "")},
    submitApi: "https://backend.example.com", googleClientId: "cid.apps.googleusercontent.com",
    dataUrl: "./marketplace.json"   // read the local seed in tests (not the remote approved branch)
  }));
  ${seedSession ? `localStorage.setItem("crv-session", JSON.stringify({ key: "old-key", email: "tester@example.com", exp: Date.now() + 3600000 }));` : ""}
  ${seedSubmission ? `localStorage.setItem("crv-submissions", JSON.stringify([{ number: 7, url: "", title: "My guide", kind: "repair", ts: 1, merged: false, state: "open", notified: false }]));` : ""}
  ${seedVehicles ? `localStorage.setItem("crv-vehicles", JSON.stringify([
    { id: "vHonda", vin: "5J6RW2H50JL000000", nick: "", year: 2018, make: "Honda", model: "CR-V", ts: 1 },
    { id: "vSub", vin: "4S4BSANC1F3000000", nick: "Wagon", year: 2016, make: "Subaru", model: "Outback", ts: 2 }
  ]));` : ""}

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
      if (method === "GetAppConfig") return J({ amazonTag: ${JSON.stringify(cfgTag || "")} });
      if (method === "LogClientError") return J({ ok: true });
      return J({});
    }
    // Anthropic API — branch on the system prompt
    if (u.includes("api.anthropic.com")) {
      const body = JSON.parse(o.body); const sys = body.system || "";
      window.__anthropic = window.__anthropic || []; window.__anthropic.push({ model: body.model, sys: sys.slice(0, 60), hasKey: !!(o.headers && o.headers["x-api-key"]) });
      const text = (t) => Promise.resolve({ ok: true, json: () => Promise.resolve({ content: [{ type: "text", text: t }], stop_reason: "end_turn" }) });
      const GUIDE = JSON.stringify({ title: "Test Guide", subtitle: "x", region: "us", env: ["garage"], fits: { makes: ["Test"], models: ["T"], yearFrom: 2010, yearTo: 2020 }, phases: [{ name: "P1", steps: [{ t: "s", body: [{ type: "check", items: ["a"] }] }] }], tools: [{ id: "jack-and-stands" }], parts: [{ g: "G", items: [{ n: "part", q: "q" }] }] });
      if (JSON.stringify(body.messages || "").includes("__XSS_ERR__")) return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('<img src=x onerror="window.__xss=1">') });
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

// ============ Scenario 3: Ask Claude error path must be escaped (no XSS) ============
{
  console.log("client<->server: Ask Claude error path is escaped (no XSS)");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedSession: false, seedSubmission: false }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const x = await page.evaluate(async () => {
    window.__xss = undefined;
    state.apiKey = "sk-test";
    const log = document.createElement("div"); document.body.appendChild(log);
    const typing = document.createElement("div");
    const foot = document.createElement("div"); foot.innerHTML = '<div class="attachchip hidden" id="attach"></div>';
    chatHistory = [];
    await sendToClaude("__XSS_ERR__", "", log, typing, foot);
    await new Promise((r) => setTimeout(r, 80));
    return { xss: window.__xss, html: log.innerHTML };
  });
  check("Ask Claude error path does not execute injected HTML", x.xss === undefined);
  check("Ask Claude error text is escaped in the DOM", /&lt;img/.test(x.html) && !/<img/.test(x.html));
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 4: Branding — app identity is "AI Auto Repairman" ============
{
  console.log("branding: app identity is AI Auto Repairman (not CR-V)");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const b = await page.evaluate(async () => ({
    title: document.title,
    topTitle: document.getElementById("topTitle").textContent,
    manifest: await (await fetch("./manifest.webmanifest")).json(),
  }));
  const DASH = /[—–]/; // em-dash / en-dash
  check("document.title is AI Auto Repairman", /AI Auto Repairman/.test(b.title));          // T-4a-title
  check("document.title has no CR-V/Honda", !/CR-?V|Honda/i.test(b.title));                 // T-4a-nobrand
  check("home topTitle is AI Auto Repairman", /AI Auto Repairman/.test(b.topTitle));         // T-4a-topTitle
  check("home topTitle has no CR-V", !/CR-?V/i.test(b.topTitle));
  check("title has no em/en dash", !DASH.test(b.title));                                      // T-4a-nodash
  eq("manifest name", b.manifest.name, "AI Auto Repairman");                                 // T-4b-name
  check("manifest short_name has no CR-V", !/CR-?V/i.test(b.manifest.short_name));            // T-4b-nobrand
  check("manifest description is generic (no CR-V/Honda)", !/CR-?V|Honda/i.test(b.manifest.description));
  check("manifest strings have no em/en dash", !DASH.test(b.manifest.name + b.manifest.short_name + b.manifest.description)); // T-4b-nodash
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 5a: Home — empty garage shows add-vehicle CTA first, Popular below ============
{
  console.log("home: empty-garage add-vehicle CTA first + popular below, no guide ring");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    await loadMarket(); await new Promise((r) => setTimeout(r, 150));
    const view = document.getElementById("view");
    const h1 = view.querySelector("h1"), cta = document.getElementById("addFirstV");
    const ctaFirst = !!cta && !!h1 && (h1.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return {
      route, topTitle: document.getElementById("topTitle").textContent,
      vehCount: JSON.parse(localStorage.getItem("crv-vehicles") || "[]").length,
      hasCta: !!cta, ctaText: cta ? cta.textContent : "", ctaFirst,
      hasRing: !!view.querySelector(".ring"), hasPhase: !!view.querySelector(".prow"),
      hasContinue: !!document.getElementById("homeContinue"),
      text: view.textContent, pct: overallPct(),
    };
  });
  check("boots to home route", r.route === "home");                                          // T-5-route-home
  check("garage empty in this scenario", r.vehCount === 0);
  check("home shows add-vehicle CTA when no vehicles", r.hasCta && /add (a |your )?(first )?vehicle/i.test(r.ctaText)); // T-5c-cta
  check("add-vehicle CTA is the first block after the brand h1", r.ctaFirst);                // T-5c-cta-first
  check("home does not render the guide ring/phase list", !r.hasRing && !r.hasPhase);        // T-5-no-ring
  check("Popular Repair Guides shown even with no vehicles", /Popular Repair Guides/i.test(r.text)); // T-5k-empty-popular
  check("no Continue affordance at 0% progress", !r.hasContinue);                            // T-5j-no-continue
  check("overallPct is finite after boot", Number.isFinite(r.pct));                          // T-5-boot-pct
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 5b: Home — vehicle cards, dropdown, select/deselect, filtered New/Popular ============
{
  console.log("home: vehicle cards + dropdown + select/deselect toggle + filtered lists");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    await loadMarket(); await new Promise((r) => setTimeout(r, 150));
    const view = document.getElementById("view"), bar = document.getElementById("vehbar"), dd = document.getElementById("vehSel");
    return {
      cardCount: view.querySelectorAll(".vcard[data-vid]").length,
      hasAddCard: !!document.getElementById("addVCard"),
      hasNew: /New Repair Guides/i.test(view.textContent),
      hasPop: /Popular Repair Guides/i.test(view.textContent),
      barVisible: !!bar && !bar.classList.contains("hidden"),
      ddPresent: !!dd, ddDefault: dd ? dd.value : "__none",
    };
  });
  check("home lists a card per seeded vehicle", r.cardCount === 2);                          // T-5d-cards
  check("home shows an Add vehicle card", r.hasAddCard);                                     // T-5d-addcard
  check("home has a New Repair Guides section", r.hasNew);                                   // T-5e-new-head
  check("home has a Popular Repair Guides section", r.hasPop);                               // T-5e-pop-head
  check("sticky vehicle bar present + visible with vehicles", r.ddPresent && r.barVisible);  // T-5f-bar-present / T-5f-bar-visibility
  check("dropdown defaults to All ('') when no active vehicle", r.ddDefault === "");         // T-5f-default (none)

  const sel = await page.evaluate(async () => {
    document.querySelector('.vcard[data-vid="vHonda"]')?.click();
    await new Promise((r) => setTimeout(r, 180));
    const newBox = document.getElementById("homeNew"), popBox = document.getElementById("homePopular");
    return {
      active: state.activeVehicle, persisted: JSON.parse(localStorage.getItem("crvapp1")).activeVehicle,
      cardOn: document.querySelector('.vcard[data-vid="vHonda"]')?.classList.contains("on"),
      ddValue: document.getElementById("vehSel").value,
      newText: newBox ? newBox.textContent : "",
      newFirst: newBox && newBox.querySelector(".mkt") ? newBox.querySelector(".mkt").getAttribute("data-id") : "",
      popFirst: popBox && popBox.querySelector(".mkt") ? popBox.querySelector(".mkt").getAttribute("data-id") : "",
    };
  });
  check("selecting a card sets state.activeVehicle", sel.active === "vHonda");                // T-5d-select
  check("selection persists to crvapp1", sel.persisted === "vHonda");
  check("selected card gets the 'on' class", sel.cardOn === true);                           // T-5d-onclass
  check("dropdown syncs to the selected vehicle", sel.ddValue === "vHonda");                 // T-5f-sync
  check("filtered lists exclude a non-matching guide (no Outback for Honda)", !/Outback/i.test(sel.newText)); // T-5i-filter
  check("New list (Honda pool) is newest-first: CR-V entry", sel.newFirst === "mkt-crv-s1"); // T-5h-new-order
  check("Popular list (Honda pool) is highest-count first: oil change (34)", sel.popFirst === "mkt-oil-change-universal"); // T-5g-pop-order

  const de = await page.evaluate(async () => {
    document.querySelector('.vcard[data-vid="vHonda"]')?.click(); // toggle off
    await new Promise((r) => setTimeout(r, 180));
    return { active: state.activeVehicle, ddValue: document.getElementById("vehSel").value, newText: document.getElementById("homeNew").textContent };
  });
  check("clicking the active card again clears the filter", de.active === "" || de.active == null); // T-5d-deselect
  check("dropdown resets to All on deselect", de.ddValue === "");
  check("unfiltered list now includes the Outback guide", /Outback/i.test(de.newText));      // T-5i-filter (unfiltered)
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 5c: Home — dropdown defaults to the last selected vehicle + drives selection ============
{
  console.log("home: dropdown defaults to last selected vehicle and drives the filter");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true, activeVehicle: "vSub" }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    await loadMarket(); await new Promise((r) => setTimeout(r, 150));
    const dd = document.getElementById("vehSel");
    return {
      opts: [...dd.options].map((o) => o.value),
      ddDefault: dd.value,
      cardOn: document.querySelector('.vcard[data-vid="vSub"]')?.classList.contains("on"),
    };
  });
  check("dropdown first option is All vehicles ('')", r.opts[0] === "");                      // T-5f-options
  check("dropdown has an option per vehicle", r.opts.includes("vHonda") && r.opts.includes("vSub"));
  check("dropdown defaults to the last selected vehicle (vSub)", r.ddDefault === "vSub");     // T-5f-default
  check("preset vehicle card shows selected", r.cardOn === true);

  const ch = await page.evaluate(async () => {
    const dd = document.getElementById("vehSel");
    dd.value = "vHonda"; dd.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 180));
    return { active: state.activeVehicle, cardOn: document.querySelector('.vcard[data-vid="vHonda"]')?.classList.contains("on") };
  });
  check("changing the dropdown sets state.activeVehicle", ch.active === "vHonda");            // T-5f-change
  check("cards re-sync to the dropdown change", ch.cardOn === true);                          // T-5f-sync
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 5d: Home — Continue affordance + guide route + install route + home back ============
{
  console.log("home: Continue for in-progress guide, guide route, install routes to guide");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    // Make the active guide (crv-s1) partially complete, then re-render home.
    // Step 0 may carry checkboxes, so complete it the way stepComplete() checks.
    const s0 = STEPS[0], n = nChecks(s0);
    if (n) { for (let i = 0; i < n; i++) state.checks[s0.id + "#" + i] = true; } else { state.done[s0.id] = true; }
    saveState(); render(); await new Promise((r) => setTimeout(r, 150));
    const out = { hasContinue: !!document.getElementById("homeContinue"), pct: overallPct() };
    document.getElementById("homeContinue")?.click();
    await new Promise((r) => setTimeout(r, 150));
    out.routeAfter = route; out.topTitle = document.getElementById("topTitle").textContent;
    out.ringOnGuide = !!document.querySelector("#view .ring");
    document.getElementById("homeBtn").click();
    await new Promise((r) => setTimeout(r, 150));
    out.routeHome = route;
    return out;
  });
  check("Continue affordance shown for an in-progress guide", r.hasContinue);                 // T-5j-continue
  check("progress is partial (0 < pct < 100)", r.pct > 0 && r.pct < 100);
  check("Continue opens the guide dashboard (ring visible)", r.routeAfter === "guide" && r.ringOnGuide); // T-5j-continue-route
  check("guide route shows the guide title", r.topTitle.length > 0 && !/AI Auto Repairman/.test(r.topTitle));
  check("Home button returns to generic home", r.routeHome === "home");                       // T-5-home-back

  const inst = await page.evaluate(async () => {
    const cat = await loadMarket();
    const outback = cat.guides.find((g) => g.id === "mkt-outback-frontbrakes");
    openMarketGuide(outback);
    await new Promise((r) => setTimeout(r, 100));
    document.getElementById("mInstall")?.click();
    await new Promise((r) => setTimeout(r, 180));
    return { route, active: state.activeGuide };
  });
  check("installing a marketplace guide lands on the guide route", inst.route === "guide");   // T-5-install-route
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 6: Ask Claude — photo attach (camera + gallery) + generic greeting ============
{
  console.log("chat: photo attach (camera + gallery) + generic greeting");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const c = await page.evaluate(async () => {
    chatHistory = []; openChat(null); await new Promise((r) => setTimeout(r, 150));
    return {
      hasCam: !!document.getElementById("chatCam"),
      hasPhoto: !!document.getElementById("chatPhoto"),
      hasFile: !!document.getElementById("chatFile"),
      greet: (document.getElementById("chatlog") || {}).textContent || "",
    };
  });
  check("chat composer has a camera button", c.hasCam);                                       // T-6-attach-controls
  check("chat composer has a gallery button", c.hasPhoto);
  check("chat composer has a hidden file input", c.hasFile);
  check("chat greeting is generic (no CR-V/Session-1/ECT2/HG-1)", !/CR-?V|Session-?1|ECT2|HG-1/i.test(c.greet)); // T-6-greeting
  check("chat greeting invites attaching a photo", /photo/i.test(c.greet));

  const cam = await page.evaluate(async () => {
    window.alert = () => {};                 // swallow the "camera unavailable" fallback alert
    window.__gum = null;
    if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
    navigator.mediaDevices.getUserMedia = (c) => { window.__gum = c; return Promise.reject(new Error("no camera in test")); };
    document.getElementById("chatCam")?.click();
    await new Promise((r) => setTimeout(r, 80));
    return { gum: window.__gum };
  });
  // Camera button reuses the live-capture path (startCapture 'photo' -> getUserMedia video, no audio).
  check("camera button opens the live camera in photo mode", !!cam.gum && !!cam.gum.video && cam.gum.audio === false); // T-6-camera-wired

  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#chatFile", { name: "pic.png", mimeType: "image/png", buffer: PNG });
  await page.waitForTimeout(250);
  const gal = await page.evaluate(() => ({
    pend: !!pendingImage && /^data:image\//.test(pendingImage),
    chip: !document.getElementById("attach").classList.contains("hidden"),
  }));
  check("selecting a file sets a downscaled data URL as pendingImage", gal.pend);            // T-6-gallery
  check("attach chip shows after selecting a photo", gal.chip);

  const snd = await page.evaluate(async () => {
    document.getElementById("chatSend").click();
    await new Promise((r) => setTimeout(r, 200));
    const last = [...chatHistory].reverse().find((m) => m.role === "user");
    return { hasImg: !!(last && last.content.some((b) => b.type === "image")), cleared: !pendingImage };
  });
  check("submitting sends an image content block to Claude", snd.hasImg);                     // T-6-send-image
  check("pendingImage is cleared after send", snd.cleared);
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 7: Guide YouTube video block (facade -> youtube-nocookie, XSS-safe) ============
{
  console.log("guide: YouTube video block renders a click-to-load facade, id-validated");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const v = await page.evaluate(async () => {
    const g = createGuide({ title: "VidGuide", phases: [{ name: "P1", steps: [
      { t: "s0", body: [{ type: "video", id: "dQw4w9WgXcQ" }] },
      { t: "s1", body: [{ type: "video", id: "https://youtu.be/dQw4w9WgXcQ?t=5" }] },
      { t: "s2", body: [{ type: "video", id: "<script>alert(1)</script>" }] },
      { t: "s3", body: [{ type: "check", items: ["only check"] }] },
    ] }] });
    setActive(g.id); goGuide();
    const R = {};
    go(0); await new Promise((r) => setTimeout(r, 60));
    const f0 = document.querySelector("#view .ytfacade");
    R.facadeId = f0 && f0.getAttribute("data-yt");
    R.iframe0 = !!document.querySelector("#view iframe");
    R.nChecksStep0 = nChecks(STEPS[0]);
    document.querySelector("#view .ytfacade .ytplay").click();
    await new Promise((r) => setTimeout(r, 60));
    const ifr = document.querySelector("#view iframe");
    R.iframeSrc = ifr ? ifr.getAttribute("src") : "";
    go(1); await new Promise((r) => setTimeout(r, 60));
    const f1 = document.querySelector("#view .ytfacade");
    R.urlId = f1 && f1.getAttribute("data-yt");
    go(2); await new Promise((r) => setTimeout(r, 60));
    R.invalidFacade = !!document.querySelector("#view .ytfacade");
    R.invalidIframe = !!document.querySelector("#view iframe");
    R.step2Html = document.getElementById("view").innerHTML;
    return R;
  });
  check("video block renders a facade carrying the video id", v.facadeId === "dQw4w9WgXcQ"); // T-7-facade
  check("facade shows no iframe until tapped", v.iframe0 === false);
  check("video block adds no progress checks", v.nChecksStep0 === 0); // T-7-progress
  check("tapping the facade loads a youtube-nocookie iframe", /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(v.iframeSrc || "")); // T-7-click-iframe
  check("a full YouTube URL resolves to the 11-char id", v.urlId === "dQw4w9WgXcQ"); // T-7-url-id
  check("an invalid video id renders nothing (no facade/iframe)", v.invalidFacade === false && v.invalidIframe === false); // T-7-xss-safe
  check("invalid video never injects <script> markup", !/<script/i.test(v.step2Html));
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 8: Amazon tag comes from the backend on startup (no user setting) ============
{
  console.log("config: Amazon tag comes from the backend (GetAppConfig) on startup");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, cfgTag: "srv-20" }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const boot = await page.evaluate(() => ({ called: !!window.__rpc.GetAppConfig, tag: (typeof amazonTag === "function") ? amazonTag() : "__nofn" }));
  check("GetAppConfig is fetched on startup", boot.called);                            // T-8-server-tag
  check("server tag is applied to amazonTag()", boot.tag === "srv-20");
  const a = await page.evaluate(async () => {
    setActive("crv-s1"); await fetchAppConfig();
    route = "tools"; render(); await new Promise((r) => setTimeout(r, 60));
    const hrefs = [...document.querySelectorAll("#view a.buy")].map((x) => x.getAttribute("href"));
    return { count: hrefs.length, tagged: hrefs.length > 0 && hrefs.every((h) => /[?&]tag=srv-20(&|$)/.test(h)), disclosure: document.getElementById("view").textContent };
  });
  check("Tools and Parts renders Amazon buy links", a.count > 0);
  check("every Amazon link carries the server-provided tag", a.tagged);                // T-8-server-tag
  check("Amazon disclosure mentions Associate (no 'No affiliate tags')", /Amazon Associate/i.test(a.disclosure) && !/No affiliate tags/i.test(a.disclosure));
  const s = await page.evaluate(async () => { openKey(); await new Promise((r) => setTimeout(r, 40)); const f = !!document.getElementById("amzTag"); closeSheet(); return { field: f }; });
  check("Settings has NO Amazon tag field (server-provided now)", s.field === false);  // T-8-no-setting
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 8b: empty backend tag -> Amazon links untagged ============
{
  console.log("config: empty backend tag -> Amazon links untagged");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, cfgTag: "" }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(200);
  const a = await page.evaluate(async () => {
    localStorage.removeItem("crv-amzn"); _amazonTag = "";
    setActive("crv-s1"); await fetchAppConfig();
    route = "tools"; render(); await new Promise((r) => setTimeout(r, 60));
    const hrefs = [...document.querySelectorAll("#view a.buy")].map((x) => x.getAttribute("href"));
    return { count: hrefs.length, untagged: hrefs.length > 0 && hrefs.every((h) => !/[?&]tag=/.test(h)) };
  });
  check("with an empty backend tag, Amazon links are untagged", a.count > 0 && a.untagged); // T-8-empty
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 9: In-app Privacy + Terms sheets + CSP allows youtube-nocookie ============
{
  console.log("policy: Privacy/Terms sheets reachable; CSP frame-src allows youtube-nocookie");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const p = await page.evaluate(async () => {
    goHome(); await new Promise((r) => setTimeout(r, 60));
    document.getElementById("privacyLink")?.click(); await new Promise((r) => setTimeout(r, 40));
    const privTitle = (document.querySelector(".sheet .head b") || {}).textContent || "";
    const privText = (document.querySelector(".sheet .body") || {}).textContent || "";
    closeSheet();
    document.getElementById("termsLink")?.click(); await new Promise((r) => setTimeout(r, 40));
    const termsTitle = (document.querySelector(".sheet .head b") || {}).textContent || "";
    const termsText = (document.querySelector(".sheet .body") || {}).textContent || "";
    closeSheet();
    setActive("crv-s1"); goGuide(); await new Promise((r) => setTimeout(r, 60));
    const guideHasLinks = !!document.getElementById("privacyLink") && !!document.getElementById("termsLink");
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    return { privTitle, privText, termsTitle, termsText, guideHasLinks, csp };
  });
  check("Home Privacy link opens the Privacy Policy sheet", /Privacy Policy/i.test(p.privTitle)); // T-9-privacy
  check("Home Terms link opens the Terms of Service sheet", /Terms of Service/i.test(p.termsTitle)); // T-9-terms
  check("Privacy text covers on-device storage + Amazon Associate", /(on this device|on-device|stored on)/i.test(p.privText) && /Amazon Associate/i.test(p.privText)); // T-9-content
  check("Terms text carries the professional disclaimer", /not a substitute for a professional/i.test(p.termsText));
  check("Guide footer also exposes Privacy/Terms links", p.guideHasLinks); // T-9-guide-footer
  check("CSP frame-src allows youtube-nocookie", /frame-src[^;]*youtube-nocookie\.com/.test(p.csp)); // T-9-csp
  check("CSP keeps Google frame + adds no youtube connect origin", /frame-src[^;]*accounts\.google\.com/.test(p.csp) && !/connect-src[^;]*youtube/.test(p.csp));
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario H: Hardening (single sticky header + defensive render recovery) ============
{
  console.log("hardening: single sticky header; overallPct no-steps -> 0; bad route recovers to home");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const h = await page.evaluate(async () => {
    const cs = (id) => getComputedStyle(document.getElementById(id)).position;
    const wrap = document.getElementById("topwrap");
    const R = {
      wrapSticky: !!wrap && cs("topwrap") === "sticky",
      topNotSticky: cs("top") !== "sticky",
      vehbarNotSticky: cs("vehbar") !== "sticky",
      vehbarInWrap: !!wrap && wrap.contains(document.getElementById("vehbar")),
    };
    // overallPct with zero steps must be 0, not NaN
    const saved = TOTAL_STEPS; TOTAL_STEPS = 0; R.pctZero = overallPct(); TOTAL_STEPS = saved;
    // a bad step index must recover to home, not throw / white-screen
    route = "step"; cur = 999999; render(); await new Promise((r) => setTimeout(r, 60));
    R.recoveredRoute = route;
    R.viewNotEmpty = (document.getElementById("view").textContent || "").length > 0;
    return R;
  });
  check("header is a single sticky container (#topwrap)", h.wrapSticky); // T-H-sticky
  check("#top is no longer individually sticky", h.topNotSticky);
  check("#vehbar is no longer individually sticky", h.vehbarNotSticky);
  check("#vehbar lives inside the sticky #topwrap", h.vehbarInWrap);
  check("overallPct() with zero steps returns 0 (not NaN)", h.pctZero === 0); // T-H-pct
  check("a bad step index recovers to Home (no crash)", h.recoveredRoute === "home"); // T-H-recover
  check("recovered view is not blank", h.viewNotEmpty);
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 10: Marketplace hides guides that do not fit the active vehicle ============
{
  console.log("marketplace: hides non-applicable guides when a vehicle is active");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true, activeVehicle: "vHonda" }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const f = await page.evaluate(async () => {
    await loadMarket(); openMarket(); await new Promise((r) => setTimeout(r, 150));
    const body = document.querySelector(".sheet .body");
    const ids = [...document.querySelectorAll(".sheet .mkt")].map((m) => m.dataset.id);
    return { txt: body.textContent, ids, hasAll: /All guides/i.test(body.textContent) };
  });
  check("Honda active: the Outback guide is hidden", !f.ids.includes("mkt-outback-frontbrakes") && !/Outback/i.test(f.txt)); // T-10-filtered
  check("Honda active: fitting guides (CR-V + universal) are shown", f.ids.includes("mkt-crv-s1") && f.ids.includes("mkt-oil-change-universal"));
  check("no 'All guides' section when a vehicle is active", !f.hasAll);
  const e2 = await page.evaluate(async () => {
    _marketCat = { version: 1, guides: [{ id: "mkt-tesla", guide: { title: "Tesla Guide", subtitle: "x", fits: { makes: ["Tesla"], models: ["Model 3"] }, phases: [{ name: "P", steps: [{ t: "s", body: [] }] }] }, rating: { avg: 0, count: 0 }, reviews: [] }] };
    openMarket(); await new Promise((r) => setTimeout(r, 150));
    const body = document.querySelector(".sheet .body");
    const ids = [...document.querySelectorAll(".sheet .mkt")].map((m) => m.dataset.id);
    return { txt: body.textContent, ids };
  });
  check("active vehicle with zero matches shows an empty note (no catalog dump)", /no guides yet/i.test(e2.txt) && e2.ids.length === 0); // T-10-empty
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 10b: no active vehicle shows all guides ============
{
  console.log("marketplace: shows all guides when no vehicle is active");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const f = await page.evaluate(async () => {
    await loadMarket(); openMarket(); await new Promise((r) => setTimeout(r, 150));
    const body = document.querySelector(".sheet .body");
    const ids = [...document.querySelectorAll(".sheet .mkt")].map((m) => m.dataset.id);
    return { hasAll: /All guides/i.test(body.textContent), ids };
  });
  check("no active vehicle shows an All guides section", f.hasAll); // T-10-all
  check("All guides lists every catalog entry", f.ids.includes("mkt-crv-s1") && f.ids.includes("mkt-outback-frontbrakes") && f.ids.includes("mkt-oil-change-universal"));
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 11: floating Claude+voice row (icon-only) + guide Start button ============
{
  console.log("ui: Claude + voice buttons share a floating row; Ask is icon-only");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const u = await page.evaluate(async () => {
    const fabs = document.getElementById("fabs");
    const R = {
      fabs: !!fabs,
      micInFabs: !!fabs && fabs.contains(document.getElementById("mic")),
      askInFabs: !!fabs && fabs.contains(document.getElementById("ask")),
      askText: (document.getElementById("ask").textContent || "").trim(),
      askHasSvg: !!document.querySelector("#ask svg"),
    };
    const m = document.getElementById("mic").getBoundingClientRect(), a = document.getElementById("ask").getBoundingClientRect();
    R.sameRow = Math.abs(m.top - a.top) < 4;
    document.getElementById("ask").click(); await new Promise((r) => setTimeout(r, 60));
    R.chatOpened = /Ask Claude/i.test((document.querySelector(".sheet .head b") || {}).textContent || "");
    return R;
  });
  check("floating action row (#fabs) exists", u.fabs);
  check("voice + Claude buttons are both in the row", u.micInFabs && u.askInFabs);
  check("Claude button is icon-only (no 'Ask Claude' text)", u.askText === "" && u.askHasSvg);
  check("Claude + voice buttons sit on the same row", u.sameRow);
  check("tapping the Claude button opens the chat", u.chatOpened);
  eq("no page errors", errs, []);
  await ctx.close();
}

{
  console.log("ui: guide dashboard has a Start/Continue button beside the ring");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const g = await page.evaluate(async () => {
    setActive("crv-s1"); goGuide(); await new Promise((r) => setTimeout(r, 80));
    const row = document.querySelector(".meterrow"), ring = document.querySelector(".meterrow .ring"), btn = document.getElementById("startBtn");
    const R = { hasRow: !!row, ringInRow: !!(row && ring), hasBtn: !!btn, label: btn ? (btn.textContent || "").replace(/\s+/g, " ").trim() : "" };
    if (row && ring && btn) {
      const rr = ring.getBoundingClientRect(), br = btn.getBoundingClientRect();
      R.ringLeftOfBtn = rr.left < br.left;
      R.sameSize = Math.abs(rr.width - br.width) < 2 && Math.abs(rr.height - br.height) < 2;
    }
    R.isStart = /Start/i.test(R.label);
    btn.click(); await new Promise((r) => setTimeout(r, 60));
    R.routeAfter = route;
    return R;
  });
  check("guide dashboard has a meter row containing the ring", g.hasRow && g.ringInRow);
  check("a Start/Continue button exists beside the ring", g.hasBtn);
  check("ring is left-aligned, button is right-aligned", g.ringLeftOfBtn);
  check("the button matches the ring's dimensions", g.sameSize);
  check("a fresh guide shows 'Start'", g.isStart);
  check("tapping Start opens a step", g.routeAfter === "step");
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 12: deidentified client error logging (safe recovery + report) ============
{
  console.log("errlog: script errors recover safely and report a deidentified failure");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  // (a) a forced render error recovers to Home AND reports with context "render", scrubbed.
  const r = await page.evaluate(async () => {
    window.__rpc.LogClientError = null;
    Object.defineProperty(state, "activeVehicle", { configurable: true, get() { throw new Error("boom vin 1HGRW2H50JL000000 mail a@b.com key sk-ant-ABCdef123"); } });
    route = "home"; render(); await new Promise((r) => setTimeout(r, 100));
    Object.defineProperty(state, "activeVehicle", { configurable: true, writable: true, value: "" });
    const p = window.__rpc.LogClientError;
    return {
      route, viewNotBlank: (document.getElementById("view").textContent || "").length > 0,
      payload: p, keys: p ? Object.keys(p) : [],
    };
  });
  check("forced render error recovers to Home (not blank)", r.route === "home" && r.viewNotBlank); // T-12-render
  check("render error is reported with context 'render'", !!r.payload && r.payload.context === "render");
  check("report scrubs VIN, email, and API key", /\[VIN\]/.test(r.payload.message) && /\[EMAIL\]/.test(r.payload.message) && /\[KEY\]/.test(r.payload.message)); // T-12-scrub
  check("report never leaks the raw secrets", !/1HGRW2H50JL000000/.test(JSON.stringify(r.payload)) && !/a@b\.com/.test(JSON.stringify(r.payload)) && !/sk-ant-ABCdef123/.test(JSON.stringify(r.payload)));
  check("payload contains only the allowlisted fields", r.keys.length > 0 && r.keys.every((k) => ["message", "stack", "route", "appVersion", "userAgent", "context", "ts"].includes(k))); // T-12-allowlist

  // (b) global window "error" and "unhandledrejection" route through the reporter.
  const g = await page.evaluate(async () => {
    window.__rpc.LogClientError = null;
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("winerr sk-ant-ZZZ"), message: "winerr" }));
    await new Promise((r) => setTimeout(r, 40));
    const a = window.__rpc.LogClientError;
    window.__rpc.LogClientError = null;
    const pr = Promise.reject(new Error("rejerr")); pr.catch(() => {});
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: pr, reason: new Error("rejerr") }));
    await new Promise((r) => setTimeout(r, 40));
    const b = window.__rpc.LogClientError;
    return { errCtx: a && a.context, errScrubbed: a && !/sk-ant-ZZZ/.test(a.message), rejCtx: b && b.context };
  });
  check("window 'error' is reported (context window.onerror), scrubbed", g.errCtx === "window.onerror" && g.errScrubbed); // T-12-global
  check("unhandledrejection is reported", g.rejCtx === "unhandledrejection");

  // (c) reporter never throws even when building the payload fails (poisoned error).
  const s = await page.evaluate(() => {
    const poison = {};
    Object.defineProperty(poison, "message", { get() { throw new Error("nested"); } });
    Object.defineProperty(poison, "stack", { get() { throw new Error("nested"); } });
    let threw = false;
    try { reportClientError("safe", poison); } catch (e) { threw = true; }
    return { threw };
  });
  check("reporter never throws (self-guarded)", s.threw === false); // T-12-safe

  // (d) reporter no-ops when no backend is configured.
  const gate = await page.evaluate(async () => {
    window.__rpc.LogClientError = null;
    const sv = state.submitApi, cv = CONFIG.submitApi; state.submitApi = ""; CONFIG.submitApi = "";
    reportClientError("gated", new Error("y")); await new Promise((r) => setTimeout(r, 40));
    state.submitApi = sv; CONFIG.submitApi = cv;
    return { called: !!window.__rpc.LogClientError };
  });
  check("reporter no-ops when no backend is configured", gate.called === false); // T-12-gated
  eq("no page errors", errs, []);
  await ctx.close();
}

// ============ Scenario 13: built-in guide titled by the job; tagged car drives discovery ============
{
  console.log("guide: built-in guide is titled by the job; the tagged car drives discovery");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true, activeVehicle: "vHonda" }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const t = await page.evaluate(async () => {
    const g = guideById("crv-s1");
    await loadMarket(); openMarket(); await new Promise((r) => setTimeout(r, 150));
    const ids = [...document.querySelectorAll(".sheet .mkt")].map((m) => m.dataset.id);
    const body = document.querySelector(".sheet .body").textContent;
    return { title: g.title, fitsMakes: ((g.fits && g.fits.makes) || []).join(","), shown: ids.includes("mkt-crv-s1"), body };
  });
  check("built-in guide title is the job (Replace AC Compressor and ECT2)", t.title === "Replace AC Compressor and ECT2"); // T-title-builtin
  check("title carries no vehicle name", !/CR-?V|Honda/i.test(t.title));
  check("tagged car (fits Honda) still drives discovery", t.fitsMakes.toLowerCase().includes("honda") && t.shown); // T-title-discovery
  check("marketplace lists the guide by its job title", /Replace AC Compressor and ECT2/.test(t.body));
  eq("no page errors", errs, []);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} assertions passed.`);
