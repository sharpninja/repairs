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
    initialize(o) { this._cb = o.callback; window.__gis = o; },   // capture config (ux_mode/login_uri) for assertions
    renderButton(el) { el.innerHTML = '<button id="fakeG">Sign in with Google</button>'; el.querySelector("#fakeG").onclick = () => this._cb && this._cb({ credential: ${JSON.stringify(jwt)} }); },
    prompt() {}
  } } };

  // ---- Mock every network call ----
  window.__rpc = {};
  const realFetch = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    const J = (obj) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });
    // Top-level redirect sign-in: the app swaps a one-time handoff code for a session key.
    if (u.includes("/auth/google/redeem")) {
      window.__redeem = JSON.parse((o && o.body) || "{}");
      return J({ sessionKey: "sess-redeem", email: "tester@example.com", expiresAt: String(Date.now() + 3600000) });
    }
    // Submit/gRPC backend
    if (u.includes("/repairs.v1.SubmissionService/")) {
      const method = u.split("/").pop();
      const body = JSON.parse((o && o.body) || "{}");
      window.__rpc[method] = body;
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

  // -- Session-tagged review submission via the real UI flow. Sign-in is the redirect
  //    flow now: simulate returning from Google with a one-time handoff code in the URL. --
  const rev = await page.evaluate(async () => {
    location.hash = "#authcode=rev-code";
    await redeemHandoff();                                 // -> POST /auth/google/redeem -> session
    const cat = await loadMarket();
    openMarketGuide(cat.guides[0]);
    await new Promise((r) => setTimeout(r, 60));
    document.querySelectorAll("#myStars .st")[4].click(); // 5 stars
    document.getElementById("revText").value = "Clear and safe.";
    document.getElementById("revPR").click();             // -> submit sheet (already signed in)
    await new Promise((r) => setTimeout(r, 60));
    document.getElementById("subGo").click();              // -> SubmitReview
    await new Promise((r) => setTimeout(r, 80));
    return {
      redeemCode: window.__redeem && window.__redeem.code,
      hashCleared: location.hash === "",
      review: window.__rpc.SubmitReview,
      status: document.getElementById("subStatus").textContent,
      recorded: JSON.parse(localStorage.getItem("crv-submissions") || "[]"),
    };
  });
  check("handoff code redeemed on return from the redirect", rev.redeemCode === "rev-code");
  check("handoff code stripped from the URL after redeem", rev.hashCleared);
  check("SubmitReview tagged with the session key", rev.review && rev.review.sessionKey === "sess-redeem");
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
  check("SubmitRepair tagged with the session key", rep.repair && rep.repair.sessionKey === "sess-redeem");
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

// ============ Scenario 3b: redirect Google sign-in (ux_mode:redirect + one-time handoff) ============
{
  console.log("client<->server: redirect sign-in (ux_mode:redirect + handoff redemption)");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  // Return leg: the backend 303'd us back into the PWA with a one-time code in the fragment.
  await page.goto(BASE + "/index.html#authcode=boot-code", { waitUntil: "load" });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    redeemCode: window.__redeem && window.__redeem.code,
    loggedIn: loggedIn(),
    refreshed: !!window.__rpc.RefreshSession,
    hash: location.hash,
  }));
  check("boot redeems the handoff code from the URL fragment", r.redeemCode === "boot-code"); // T-R-redeem
  check("session established after returning from the redirect", r.loggedIn);                  // T-R-login
  check("session rotated immediately after redeem (negotiate ran)", r.refreshed);              // T-R-negotiate
  check("handoff code stripped from the URL", r.hash === "");                                  // T-R-strip

  // Signed OUT: the sign-in button is configured for the redirect flow, not a popup callback.
  const cfg = await page.evaluate(async () => {
    signOut();
    openSubmitReview({ id: "mkt-crv-s1" }, "Title", 5, "Clear and safe review text.");
    await new Promise((res) => setTimeout(res, 120));
    return { gis: window.__gis };
  });
  check("GIS is configured for redirect (ux_mode:redirect)", cfg.gis && cfg.gis.ux_mode === "redirect");            // T-R-uxmode
  check("login_uri targets the backend /auth/google/callback", cfg.gis && /\/auth\/google\/callback$/.test(cfg.gis.login_uri || "")); // T-R-loginuri
  check("no JS callback is registered in redirect mode", cfg.gis && !cfg.gis.callback);                             // T-R-nocallback
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
    const privTitle = (document.querySelector(".sheet .head h2") || {}).textContent || "";
    const privText = (document.querySelector(".sheet .body") || {}).textContent || "";
    closeSheet();
    document.getElementById("termsLink")?.click(); await new Promise((r) => setTimeout(r, 40));
    const termsTitle = (document.querySelector(".sheet .head h2") || {}).textContent || "";
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
    R.chatOpened = /Ask Claude/i.test((document.querySelector(".sheet .head h2") || {}).textContent || "");
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

// ============ Scenario A11y-A: keyboard-operable custom widgets ============
{
  console.log("a11y-A: star radiogroup + button cards + video-thumb keyboard");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT, seedVehicles: true }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  // -- Star rating widget: radiogroup, roles, keyboard operation --
  const star = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cat = await loadMarket();
    openMarketGuide(cat.guides[0]);
    await sleep(120);
    const sp = document.getElementById("myStars");
    const radios = sp ? [...sp.querySelectorAll('[role=radio]')] : [];
    const named = radios.length === 5 && radios.every((r) => /\bstars?\b/i.test(r.getAttribute("aria-label") || ""));
    const haveChecked = radios.length === 5 && radios.every((r) => r.hasAttribute("aria-checked"));
    const focusable = radios.some((r) => r.tabIndex === 0);
    // keyboard-only: select the 3rd star with Enter, then Save (proves no mouse needed)
    if (radios[2]) { radios[2].focus(); radios[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    await sleep(40);
    const after = sp ? [...sp.querySelectorAll('[role=radio]')] : [];
    const checkedIdx = after.findIndex((r) => r.getAttribute("aria-checked") === "true");
    if (document.getElementById("revText")) document.getElementById("revText").value = "Clear, safe, keyboard-set.";
    const sub = document.getElementById("revSubmit"); if (sub) sub.click();
    await sleep(30);
    return {
      groupRole: sp && sp.getAttribute("role"), groupLabel: !!(sp && sp.getAttribute("aria-label")),
      radioCount: radios.length, named, haveChecked, focusable, checkedIdx,
      savedViaKeyboard: /saved/i.test((document.getElementById("revStatus") || {}).textContent || ""),
    };
  });
  check("rating widget is a radiogroup with a name", star.groupRole === "radiogroup" && star.groupLabel); // F3/F4
  check("five stars, each a named radio with aria-checked", star.radioCount === 5 && star.named && star.haveChecked);
  check("rating widget is keyboard focusable (roving tabindex)", star.focusable);
  check("Enter selects the 3rd star (aria-checked moves)", star.checkedIdx === 2); // F1
  check("review saves after keyboard-only rating (submit gate cleared)", star.savedViaKeyboard);

  // -- Guide cards are semantic buttons with no nested interactive --
  const cards = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    closeSheet();
    await loadMarket(); openMarket(); await sleep(150);
    const mkt = document.querySelector(".sheet .mkt");
    const mktNested = mkt ? mkt.querySelectorAll("button,a,input,select,textarea").length : -1;
    closeSheet(); render(); await sleep(200);
    const home = document.querySelector("#homePopular .mkt, #homeNew .mkt");
    let opened = false;
    if (home) { home.click(); await sleep(150); opened = !!document.getElementById("myStars"); }
    return { mktTag: mkt && mkt.tagName, mktNested, homeTag: home && home.tagName, opened };
  });
  check("marketplace card is a <button>", cards.mktTag === "BUTTON");         // F5/F6
  check("card has no nested interactive elements", cards.mktNested === 0);
  check("home guide card is a <button>", cards.homeTag === "BUTTON");
  check("activating a card opens the guide detail", cards.opened);

  // -- Session-log video thumbnail is keyboard-operable --
  const vid = await page.evaluate(() => {
    const el = mediaEl({ type: "video", id: "v1", dataUrl: "data:video/mp4;base64,AAAA", ts: 1 }, false);
    const t = el.querySelector(".mth video") || el.querySelector(".mth");
    return { role: t && t.getAttribute("role"), tabindex: t && t.getAttribute("tabindex"), label: t && t.getAttribute("aria-label") };
  });
  check("session-log video thumb is a keyboard button", vid.role === "button" && vid.tabindex === "0" && /play/i.test(vid.label || "")); // F25
  eq("no page errors (a11y-A)", errs, []);
  await ctx.close();
}

// ============ Scenario A11y-B: checklist checkboxes are labeled + index-persistent ============
{
  console.log("a11y-B: checklist checkboxes labeled + index persistence");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 1. dynamic typed-block renderer
    const d = document.createElement("div"); d.innerHTML = bodyToHtml([{ type: "check", items: ["Item one", "Item two"] }]);
    const dyn = [...d.querySelectorAll('input[type=checkbox]')];
    const dynLabeled = dyn.length === 2 && dyn.every((cb) => !!cb.closest("label"));
    // 2. a real built-in step that uses a static checklist
    setActive("crv-s1");
    const gi = STEPS.findIndex((s) => nChecks(s) > 0);
    go(gi); await sleep(90);
    const cbs = [...document.querySelectorAll('input[type=checkbox]')];
    const staticLabeled = cbs.length > 0 && cbs.every((cb) => !!cb.closest("label"));
    // 3. index integrity: check the 2nd box, re-render, confirm it is still checked at index 1
    let persisted = null, labelDone = false;
    if (cbs.length >= 2) {
      cbs[1].checked = true; cbs[1].dispatchEvent(new Event("change", { bubbles: true }));
      labelDone = !!cbs[1].closest("li").querySelector("label.done");
      go(gi); await sleep(90);
      const cbs2 = [...document.querySelectorAll('input[type=checkbox]')];
      persisted = !!(cbs2[1] && cbs2[1].checked);
    }
    return { dynLabeled, staticCount: cbs.length, staticLabeled, persisted, labelDone };
  });
  check("dynamic checklist wraps each input in a label", r.dynLabeled);                 // F2/F9 (renderer)
  check("built-in static checklist wraps each input in a label", r.staticCount > 0 && r.staticLabeled);
  check("checkbox state persists by index after re-render (wiring intact)", r.persisted === true);
  check("checking a box marks its wrapping label done", r.labelDone);
  eq("no page errors (a11y-B)", errs, []);
  await ctx.close();
}

// ============ Scenario A11y-C: modal dialog semantics, focus trap/restore, base utilities ============
{
  console.log("a11y-C: sheet() dialog + focus management + sr-only/focus-visible/reduced-motion");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const opener = document.getElementById("themeBtn"); opener.focus();
    resetProgress(); // opens a simple sheet() with Cancel/Reset buttons
    await sleep(60);
    const panel = document.querySelector("#sheet .panel");
    const titleId = panel && panel.getAttribute("aria-labelledby");
    const titleEl = titleId && document.getElementById(titleId);
    const cl = document.querySelector("#sheet .cl");
    const focusedInsideOnOpen = panel && panel.contains(document.activeElement) && document.activeElement !== document.body;
    // Tab-trap: Shift+Tab from the first focusable should wrap to the last.
    const focusables = [...panel.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled);
    focusables[0].focus();
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    await sleep(20);
    const wrappedBack = document.activeElement === focusables[focusables.length - 1];
    // Escape closes the dialog
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await sleep(30);
    const closedOnEscape = !document.getElementById("sheet");
    const focusRestored = document.activeElement === opener;
    return {
      role: panel && panel.getAttribute("role"), ariaModal: panel && panel.getAttribute("aria-modal"),
      hasTitleId: !!titleId, titleTag: titleEl && titleEl.tagName, titleText: titleEl && titleEl.textContent,
      closeLabeled: !!(cl && cl.getAttribute("aria-label")),
      focusedInsideOnOpen, focusableCount: focusables.length, wrappedBack, closedOnEscape, focusRestored,
    };
  });
  check("sheet panel has role=dialog + aria-modal", r.role === "dialog" && r.ariaModal === "true"); // F10/F24
  check("sheet has an aria-labelledby pointing to a real heading", r.hasTitleId && /^H[1-6]$/.test(r.titleTag || "") && /Reset progress/i.test(r.titleText || ""));
  check("close button (.cl) has an aria-label", r.closeLabeled);
  check("opening a sheet moves focus inside the panel", r.focusedInsideOnOpen); // F7
  check("Shift+Tab from the first control wraps to the last (focus trap)", r.focusableCount >= 2 && r.wrappedBack);
  check("Escape closes the sheet", r.closedOnEscape);
  check("closing restores focus to the opener", r.focusRestored);

  // -- Capture overlay (#rec) is also a modal dialog with focus + Escape --
  // kind="audio" avoids the app's <video> branch: a plain-object getUserMedia stub is not a
  // real MediaStream, so assigning it to video.srcObject would throw in real Chromium.
  const rec = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [] });
    window.MediaRecorder = window.MediaRecorder || function () {};
    const opener = document.getElementById("mic"); opener.focus();
    await startCapture(null, "audio", () => {});
    await sleep(60);
    const ov = document.getElementById("rec");
    const role = ov && ov.getAttribute("role");
    const modal = ov && ov.getAttribute("aria-modal");
    const focusedInside = ov && ov.contains(document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await sleep(30);
    return { role, modal, focusedInside, closed: !document.getElementById("rec"), restored: document.activeElement === opener };
  });
  check("#rec capture overlay is a dialog with focus moved in", rec.role === "dialog" && rec.modal === "true" && rec.focusedInside); // F8
  check("Escape closes the capture overlay and restores focus", rec.closed && rec.restored);

  // -- Base utilities: sr-only class, global :focus-visible, prefers-reduced-motion --
  const base = await page.evaluate(() => {
    let srOnly = false, focusVisible = false, reducedMotion = false;
    for (const ss of document.styleSheets) {
      try {
        for (const rule of ss.cssRules) {
          if (rule.selectorText && /\.sr-only\b/.test(rule.selectorText)) srOnly = true;
          if (rule.selectorText && /:focus-visible/.test(rule.selectorText)) focusVisible = true;
          if (rule.media && /prefers-reduced-motion/.test(rule.media.mediaText || "")) reducedMotion = true;
        }
      } catch (e) {}
    }
    return { srOnly, focusVisible, reducedMotion };
  });
  check(".sr-only utility class exists", base.srOnly);           // F11 support utility
  check("a global :focus-visible rule exists", base.focusVisible); // F11
  check("a prefers-reduced-motion media rule exists", base.reducedMotion); // F49
  eq("no page errors (a11y-C)", errs, []);
  await ctx.close();
}

// ============ Scenario A11y-D: status messages are live regions ============
{
  console.log("a11y-D: live-region roles on status/error/toast/chat/voice");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  const rev = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cat = await loadMarket();
    openMarketGuide(cat.guides[0]); await sleep(100);
    const st = document.getElementById("revStatus");
    const before = { role: st.getAttribute("role"), live: st.getAttribute("aria-live") };
    document.getElementById("revPR").click(); await sleep(20); // no rating, no text -> validation error
    const onError = { role: st.getAttribute("role"), live: st.getAttribute("aria-live"), focusedRevText: document.activeElement === document.getElementById("revText") };
    // pick a rating + write text, then Save -> should revert to a polite status
    document.querySelector('#myStars [role=radio][data-v="4"]').click();
    document.getElementById("revText").value = "Solid guide.";
    document.getElementById("revSubmit").click(); await sleep(20);
    const onSave = { role: st.getAttribute("role"), live: st.getAttribute("aria-live"), text: st.textContent };
    return { before, onError, onSave };
  });
  check("#revStatus starts as a polite status region", rev.before.role === "status" && rev.before.live === "polite"); // F12/F21
  check("validation error switches #revStatus to an alert", rev.onError.role === "alert" && rev.onError.live === "assertive"); // F33
  check("validation error moves focus to the review text field", rev.onError.focusedRevText);
  check("saving reverts #revStatus to a polite status", rev.onSave.role === "status" && rev.onSave.live === "polite" && /saved/i.test(rev.onSave.text));

  const rest = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    closeSheet();
    // #subStatus (submit sheet)
    openSubmitReview({ id: "mkt-crv-s1" }, "Title", 5, "text"); await sleep(60);
    const sub = document.getElementById("subStatus");
    const subOk = sub.getAttribute("role") === "status" && sub.getAttribute("aria-live") === "polite";
    closeSheet();
    // #genStatus (New Repair) + #mStatus (Merge)
    openNew(); await sleep(30);
    const gen = document.getElementById("genStatus");
    const genOk = gen.getAttribute("role") === "status" && gen.getAttribute("aria-live") === "polite";
    closeSheet();
    openMerge(); await sleep(30);
    const mrg = document.getElementById("mStatus");
    const mrgOk = mrg.getAttribute("role") === "status" && mrg.getAttribute("aria-live") === "polite";
    closeSheet();
    // voice bar: .vstate/.vans are polite status regions; .vheard is explicitly silent
    const vstate = document.querySelector(".voicebar .vstate");
    const vans = document.querySelector(".voicebar .vans");
    const vheard = document.querySelector(".voicebar .vheard");
    const voiceOk = vstate.getAttribute("role") === "status" && vstate.getAttribute("aria-live") === "polite"
      && vans.getAttribute("role") === "status" && vans.getAttribute("aria-live") === "polite"
      && vheard.getAttribute("aria-live") === "off";
    // toast
    toast("Test toast message");
    const toaster = document.getElementById("toaster");
    const toastOk = toaster.getAttribute("role") === "status" && toaster.getAttribute("aria-live") === "polite";
    // chat
    openChat(null); await sleep(30);
    const chatlog = document.getElementById("chatlog"), typing = document.getElementById("typing");
    const chatOk = chatlog.getAttribute("role") === "log" && chatlog.getAttribute("aria-live") === "polite" && chatlog.getAttribute("aria-relevant") === "additions"
      && typing.getAttribute("role") === "status";
    return { subOk, genOk, mrgOk, voiceOk, toastOk, chatOk };
  });
  check("#subStatus (submit sheet) is a polite status region", rest.subOk);       // F14/F20
  check("#genStatus (New Repair) is a polite status region", rest.genOk);         // F28
  check("#mStatus (Merge) is a polite status region", rest.mrgOk);                // F28
  check("voice bar .vstate/.vans are polite; .vheard stays silent", rest.voiceOk); // F29/F30
  check("toast container is a polite status region", rest.toastOk);               // F14/F31
  check("#chatlog is a live log; #typing is a status region", rest.chatOk);       // F13
  eq("no page errors (a11y-D)", errs, []);
  await ctx.close();
}

// ============ Scenario A11y-E: names, text alternatives, headings ============
{
  console.log("a11y-E: form labels, icon-button names, star semantics, alts, callout prefixes");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  const labels = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const hasLabel = (id) => { const el = document.getElementById(id); return !!(el && el.labels && el.labels.length > 0); };
    openKey(); await sleep(30);
    const keySettings = hasLabel("keyIn") && hasLabel("modelIn");
    closeSheet();
    openAddVehicle(null); await sleep(30);
    const vehicleFields = ["vNick", "vVin", "vYear", "vMake", "vModel"].every(hasLabel);
    closeSheet();
    openSubmitRepair(guideById("crv-s1")); await sleep(30);
    const exportField = [...document.querySelectorAll('.sheet input[readonly]')].some((i) => i.labels && i.labels.length > 0);
    closeSheet();
    openNew(); await sleep(30);
    const genField = hasLabel("genPrompt");
    closeSheet();
    openMerge(); await sleep(30);
    const mergeField = hasLabel("mNote");
    closeSheet();
    openVoiceSettings(); await sleep(30);
    const voiceField = hasLabel("vw");
    closeSheet();
    // review textarea (already open in the guide-detail sheet)
    const cat = await loadMarket(); openMarketGuide(cat.guides[0]); await sleep(60);
    const revField = hasLabel("revText");
    return { keySettings, vehicleFields, exportField, genField, mergeField, voiceField, revField };
  });
  check("Claude settings fields (API key, model) are labeled", labels.keySettings);       // F23
  check("add-vehicle fields (nick/VIN/year/make/model) are labeled", labels.vehicleFields);
  check("export/submit-repair Guide field is labeled", labels.exportField);
  check("New Repair prompt textarea is labeled", labels.genField);
  check("Merge notes textarea is labeled", labels.mergeField);
  check("voice wake-word field is labeled", labels.voiceField);
  check("review textarea is labeled", labels.revField);

  const names = await page.evaluate(() => {
    const label = (id) => (document.getElementById(id) || {}).getAttribute && document.getElementById(id).getAttribute("aria-label");
    return {
      home: label("homeBtn"), theme: label("themeBtn"), mic: label("mic"),
      vGear: label("vGear"), vStop: label("vStop"),
    };
  });
  check("home/theme/mic/voice-gear/voice-stop buttons are named (aria-label)",
    !!(names.home && names.theme && names.mic && names.vGear && names.vStop)); // F27 (icon-only buttons)

  const chat = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    closeSheet();
    openChat(null); await sleep(30);
    const chatIn = document.getElementById("chatIn"), chatSend = document.getElementById("chatSend");
    const transcriptImgAlt = (() => { const d = document.createElement("div"); d.innerHTML = msgHtml("u", "hi", "data:image/jpeg;base64,AAAA"); const img = d.querySelector("img"); return img && img.getAttribute("alt"); })();
    return { chatInLabel: chatIn.getAttribute("aria-label"), chatSendLabel: chatSend.getAttribute("aria-label"), transcriptImgAlt };
  });
  check("chat textarea has an aria-label", !!chat.chatInLabel);          // F26
  check("chat send button has an aria-label", !!chat.chatSendLabel);    // F27
  check("chat transcript images carry alt text", !!chat.transcriptImgAlt); // F42

  const stars = await page.evaluate(() => {
    const html = starHtml(3);
    const d = document.createElement("div"); d.innerHTML = html;
    const wrap = d.firstElementChild;
    const glyphs = [...wrap.children].map((s) => s.textContent);
    const allHidden = [...wrap.children].every((s) => s.getAttribute("aria-hidden") === "true");
    return { role: wrap.getAttribute("role"), label: wrap.getAttribute("aria-label"), glyphs, allHidden };
  });
  check("read-only stars expose role=img with a numeric label", stars.role === "img" && /3 out of 5|3\/5|3 of 5/i.test(stars.label || "")); // F39
  check("filled vs empty stars use distinct glyphs (not color alone)", stars.glyphs.filter((g) => g === "★").length === 3 && stars.glyphs.filter((g) => g !== "★").length === 2); // F18
  check("star glyphs are hidden from AT (name comes from the wrapper)", stars.allHidden);

  const media = await page.evaluate(() => {
    const photo = mediaEl({ type: "photo", id: "p1", dataUrl: "data:image/jpeg;base64,AAAA", ts: 1 }, false);
    const audio = mediaEl({ type: "audio", id: "a1", ts: 1 }, false);
    const img = photo.querySelector(".mth img");
    const audioThumb = audio.querySelector(".mth");
    return {
      photoAlt: img && img.getAttribute("alt"),
      audioThumbHidden: audioThumb && audioThumb.querySelector('[aria-hidden="true"]') !== null,
      titleTag: photo.querySelector(".minfo") && photo.querySelector(".minfo").children[0] && photo.querySelector(".minfo").children[0].tagName,
    };
  });
  check("captured photo thumbnail has empty alt (decorative)", media.photoAlt === "");     // F40
  check("audio thumbnail emoji is hidden from AT", media.audioThumbHidden);                 // F43
  check("media item title is a real heading", media.titleTag === "H3");                    // F34

  const callouts = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    closeSheet();
    setActive("crv-s1");
    const gi = STEPS.findIndex((s) => /danger|crit|tip/.test(stepInner(s)));
    go(gi); await sleep(60);
    const call = document.querySelector(".call.danger, .call.crit, .call.tip");
    const ic = call && call.querySelector(".ic");
    const sr = call && call.querySelector(".sr-only");
    return { icHidden: ic && ic.getAttribute("aria-hidden") === "true", hasSevPrefix: !!(sr && /warning|important|tip/i.test(sr.textContent || "")) };
  });
  check("callout icon is hidden from AT", callouts.icHidden);              // F35
  check("callout carries a visually-hidden severity prefix", callouts.hasSevPrefix); // F35
  eq("no page errors (a11y-E)", errs, []);
  await ctx.close();
}

// ============ Scenario A11y-F: color contrast tokens + pinch-zoom ============
{
  console.log("a11y-F: contrast tokens (both themes) + viewport zoom");
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript({ jwt: FAKE_JWT }));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);

  const r = await page.evaluate(async () => {
    // WCAG relative-luminance contrast ratio, computed from real hex values (not eyeballed).
    function ratio(hexA, hexB) {
      const lum = (hex) => {
        hex = hex.replace("#", ""); if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const [l1, l2] = [lum(hexA), lum(hexB)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    }
    const vars = (theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      const cs = getComputedStyle(document.documentElement);
      const g = (name) => cs.getPropertyValue(name).trim(); // already a hex literal, e.g. "#faf9f5"
      return { bg: g("--bg"), card: g("--card"), card2: g("--card2"), muted: g("--muted"), accent: g("--accent"), accentText: g("--accent-text"), accentInk: g("--accent-ink"), star: g("--star"), ctrlBorder: g("--ctrl-border") };
    };
    const light = vars("light"), dark = vars("dark");
    document.documentElement.removeAttribute("data-theme");

    const out = {};
    for (const [name, t] of [["light", light], ["dark", dark]]) {
      out[name] = {
        accentTextOnBg: ratio(t.accentText, t.bg), accentTextOnCard: ratio(t.accentText, t.card), accentTextOnCard2: ratio(t.accentText, t.card2),
        accentInkOnAccent: ratio(t.accentInk, t.accent),
        starOnCard: ratio(t.star, t.card), starOnCard2: ratio(t.star, t.card2),
        mutedOnCard2: ratio(t.muted, t.card2),
        ctrlBorderOnCard: ratio(t.ctrlBorder, t.card),
      };
    }
    // readableInk(): pick white/black so ANY phase color clears 4.5:1, both directions.
    const darkPhase = "#2a5d3a", lightPhase = "#e6c229";
    out.inkDark = { ink: readableInk(darkPhase), ratio: ratio(readableInk(darkPhase), hexc(darkPhase)) };
    out.inkLight = { ink: readableInk(lightPhase), ratio: ratio(readableInk(lightPhase), hexc(lightPhase)) };
    out.viewport = document.querySelector('meta[name="viewport"]').getAttribute("content");
    return out;
  });

  check("viewport no longer caps zoom (no maximum-scale)", !/maximum-scale/.test(r.viewport)); // F15
  for (const theme of ["light", "dark"]) {
    const t = r[theme];
    check(`[${theme}] --accent-text is >=4.5:1 on bg/card/card2`, t.accentTextOnBg >= 4.5 && t.accentTextOnCard >= 4.5 && t.accentTextOnCard2 >= 4.5); // F16
    check(`[${theme}] --accent-ink is >=4.5:1 on --accent (button/badge text)`, t.accentInkOnAccent >= 4.5); // F17
    check(`[${theme}] --star is >=3:1 on card/card2`, t.starOnCard >= 3 && t.starOnCard2 >= 3);              // F37
    check(`[${theme}] --muted is >=4.5:1 on card2`, t.mutedOnCard2 >= 4.5);                                  // F38
    check(`[${theme}] control border is >=3:1 on card`, t.ctrlBorderOnCard >= 3);                            // F44
  }
  check("readableInk() picks a 4.5:1-passing ink for a dark phase color", r.inkDark.ratio >= 4.5); // F36
  check("readableInk() picks a 4.5:1-passing ink for a light phase color", r.inkLight.ratio >= 4.5 && r.inkLight.ink !== r.inkDark.ink);
  eq("no page errors (a11y-F)", errs, []);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} assertions passed.`);
