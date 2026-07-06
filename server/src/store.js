// File-backed per-user store for trust scoring + rate limiting, keyed by the
// Google email on the submission. No external DB; persist to a mounted volume
// (TRUST_STORE, default ./data/trust.json) so it survives restarts.
//
// This is a single-process, low-volume store (writes are not concurrency-safe
// across replicas) — run one submit instance, or swap in a real KV if you scale.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.TRUST_STORE || "./data/trust.json";
const BLOCK_AT = Number(process.env.TRUST_BLOCK_AT || -4);
const RATE_MS = Number(process.env.SUBMIT_RATE_MS || 60000); // 1/min default

function load() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch (e) { return {}; }
}
function save(db) {
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error("store save:", e.message); }
}
function rec(db, email) {
  return db[email] || (db[email] = { score: 0, submissions: 0, approved: 0, rejected: 0, flagged: 0, merged: 0, blocked: false, lastSubmitAt: 0 });
}

// A user is untrusted once their score sinks past the threshold (or is flagged
// blocked). Their submissions are silently dropped by the caller.
export function isBlocked(email) {
  if (!email) return false;
  const r = load()[email];
  return !!(r && (r.blocked || r.score <= BLOCK_AT));
}

// Returns {allowed:true} if the user may submit now, else {allowed:false, retryMs}.
// On allow, records the submission timestamp (consumes the rate slot).
export function tryConsumeRate(email) {
  if (!email) return { allowed: true };
  const db = load();
  const r = rec(db, email);
  const now = Date.now();
  if (r.lastSubmitAt && now - r.lastSubmitAt < RATE_MS) {
    return { allowed: false, retryMs: RATE_MS - (now - r.lastSubmitAt) };
  }
  r.lastSubmitAt = now;
  r.submissions = (r.submissions || 0) + 1;
  save(db);
  return { allowed: true };
}

// Adjust trust from a moderation verdict (approve/flag/reject).
export function noteVerdict(email, decision) {
  if (!email) return;
  const db = load();
  const r = rec(db, email);
  if (decision === "reject") { r.rejected++; r.score -= 2; }
  else if (decision === "approve") { r.approved++; r.score += 1; }
  else { r.flagged++; }
  if (r.score <= BLOCK_AT) r.blocked = true;
  save(db);
}

// A merged PR is the strongest positive signal.
export function noteMerged(email) {
  if (!email) return;
  const db = load();
  const r = rec(db, email);
  r.merged++; r.score += 2;
  if (r.score > BLOCK_AT) r.blocked = false;
  save(db);
}
