// File-backed per-user store for trust scoring + rate limiting, keyed by the
// Google email on the submission. No external DB; persist to a mounted volume
// (TRUST_STORE, default ./data/trust.json) so it survives restarts.
//
// This is a single-process, low-volume store (writes are not concurrency-safe
// across replicas) — run one submit instance, or swap in a real KV if you scale.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.TRUST_STORE || "./data/trust.json";
const BLOCK_AT = Number(process.env.TRUST_BLOCK_AT || -4);
const RATE_MS = Number(process.env.SUBMIT_RATE_MS || 60000); // 1/min default
// Append-only ban audit log for maintainer review (each entry carries receipts:
// the PR, the moderation verdict, and the timestamp). Mount on the data volume.
const BANS_STORE = process.env.BANS_STORE || "./data/bans.json";
// Append-only moderation verdict log (JSONL) for the admin dashboard.
const MODERATION_LOG_STORE = process.env.MODERATION_LOG_STORE || "./data/moderation.jsonl";

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

// ---- Immediate hard ban + reviewable audit log ----
function loadBans() { try { return JSON.parse(readFileSync(BANS_STORE, "utf8")); } catch (e) { return []; } }
function saveBans(list) {
  try { mkdirSync(dirname(BANS_STORE), { recursive: true }); writeFileSync(BANS_STORE, JSON.stringify(list, null, 2)); }
  catch (e) { console.error("bans save:", e.message); }
}

// Hard-ban a user right now (used for detected prompt-injection): sets blocked=true
// regardless of trust score, and appends an append-only audit record carrying the
// receipts a maintainer needs to review the decision (PR, verdict, timestamp).
// Returns the audit entry.
export function banUser(email, receipt = {}) {
  if (!email) return null;
  const ts = receipt.ts || new Date().toISOString();
  const db = load();
  const r = rec(db, email);
  r.blocked = true;
  r.bannedAt = ts;
  r.banReason = receipt.reason || "policy-violation";
  if (r.score > BLOCK_AT) r.score = BLOCK_AT - 1; // keep score consistent with blocked
  save(db);
  const entry = {
    email, ts,
    reason: receipt.reason || "policy-violation",
    prNumber: receipt.prNumber || 0,
    prUrl: receipt.prUrl || "",
    prTitle: receipt.prTitle || "",
    verdict: receipt.verdict || null,     // { decision, severity, categories, summary }
    evidence: receipt.evidence || "",     // short note / offending snippet
  };
  const list = loadBans();
  list.push(entry);
  saveBans(list);
  return entry;
}

// The reviewable ban log (append-only, newest last) for the maintainer.
export function listBans() { return loadBans(); }

// ---- Moderation verdict log (append-only JSONL) ----
// Appended by moderate.js on every moderation; read by the admin dashboard.
export function appendModerationLog(entry) {
  try { mkdirSync(dirname(MODERATION_LOG_STORE), { recursive: true }); appendFileSync(MODERATION_LOG_STORE, JSON.stringify(entry) + "\n"); }
  catch (e) { console.error("moderation log append:", e.message); }
}
export function readModerationLog(limit = 500) { return tailJsonl(MODERATION_LOG_STORE, limit); }

// Generic tail reader for a JSONL store: returns the last `limit` parsed lines
// (a bad line degrades to { raw }), or [] if the file is missing.
export function tailJsonl(file, limit = 500) {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-limit)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } });
  } catch (e) { return []; }
}
