// Unit tests for the backend session + trust/rate stores (pure Node, no deps).
//   node tests/store.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "repairs-store-"));
process.env.TRUST_STORE = join(dir, "trust.json");
process.env.SESSION_STORE = join(dir, "sessions.json");
process.env.SUBMIT_RATE_MS = "60000";
process.env.TRUST_BLOCK_AT = "-4";
process.env.SESSION_TTL_MS = "100000";
process.env.BANS_STORE = join(dir, "bans.json");

const store = await import("../server/src/store.js");
const session = await import("../server/src/session.js");

let pass = 0;
const t = (name, fn) => { fn(); console.log("  ✓ " + name); pass++; };

console.log("store.js — rate limiting");
t("first submission allowed, second within window blocked", () => {
  const email = "rate@example.com";
  const a = store.tryConsumeRate(email);
  assert.equal(a.allowed, true);
  const b = store.tryConsumeRate(email);
  assert.equal(b.allowed, false);
  assert.ok(b.retryMs > 0 && b.retryMs <= 60000);
});
t("different users are independent", () => {
  assert.equal(store.tryConsumeRate("other@example.com").allowed, true);
});

console.log("store.js — trust");
t("new user is not blocked", () => {
  assert.equal(store.isBlocked("fresh@example.com"), false);
});
t("two rejects push a user below threshold -> blocked (silent-drop)", () => {
  const email = "bad@example.com";
  store.noteVerdict(email, "reject"); // -2
  assert.equal(store.isBlocked(email), false);
  store.noteVerdict(email, "reject"); // -4  (<= -4)
  assert.equal(store.isBlocked(email), true);
});
t("a merged PR restores trust above the threshold", () => {
  const email = "redeemed@example.com";
  store.noteVerdict(email, "reject");
  store.noteVerdict(email, "reject"); // blocked
  assert.equal(store.isBlocked(email), true);
  store.noteMerged(email); // +2 -> -2, unblocks
  assert.equal(store.isBlocked(email), false);
});
t("approve raises score, flag is neutral", () => {
  const email = "good@example.com";
  store.noteVerdict(email, "approve");
  store.noteVerdict(email, "flag");
  assert.equal(store.isBlocked(email), false);
});

console.log("store.js — bans (immediate + audit log)");
t("banUser hard-bans a fresh user immediately, regardless of score", () => {
  const email = "injector@example.com";
  assert.equal(store.isBlocked(email), false);
  const entry = store.banUser(email, {
    reason: "prompt-injection", prNumber: 42, prUrl: "https://github.com/x/y/pull/42", prTitle: "New guide",
    verdict: { decision: "reject", severity: "high", categories: ["prompt-injection"], summary: "tried to override the moderator" },
  });
  assert.equal(store.isBlocked(email), true);
  assert.ok(entry && entry.email === email);
  assert.equal(entry.reason, "prompt-injection");
  assert.equal(entry.prNumber, 42);
  assert.ok(entry.prUrl.includes("/pull/42"));
  assert.equal(entry.verdict.decision, "reject");
});
t("ban log is reviewable and append-only with receipts (email, PR, timestamp)", () => {
  store.banUser("second@example.com", { reason: "prompt-injection", prNumber: 43, prUrl: "https://github.com/x/y/pull/43" });
  const bans = store.listBans();
  assert.ok(Array.isArray(bans) && bans.length >= 2);
  const rec = bans.find((b) => b.email === "second@example.com");
  assert.ok(rec && rec.prNumber === 43 && typeof rec.ts === "string" && rec.ts.length > 0);
});

console.log("session.js — sessions");
t("create -> resolve returns the email", () => {
  const s = session.createSession("user@example.com", "User");
  assert.ok(s.key && s.key.length >= 32);
  assert.equal(session.resolveSession(s.key).email, "user@example.com");
});
t("rotate invalidates the old key and issues a new one", () => {
  const s = session.createSession("rot@example.com", "Rot");
  const s2 = session.rotateSession(s.key);
  assert.ok(s2 && s2.key !== s.key);
  assert.equal(session.resolveSession(s.key), null);          // old dead
  assert.equal(session.resolveSession(s2.key).email, "rot@example.com"); // new live
});
t("rotate of unknown key returns null", () => {
  assert.equal(session.rotateSession("deadbeef"), null);
});
t("unknown session key does not resolve", () => {
  assert.equal(session.resolveSession("nope"), null);
});

console.log(`\n${pass} assertions passed.`);
