// Service implementation: Google login -> session key; every submission is
// tagged with the session key, rate-limited, trust-checked, then opened as a PR.
import { ConnectError, Code } from "@connectrpc/connect";
import { getStrategy } from "./auth/index.js";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { openReviewPR, openRepairPR, getStatuses } from "./github.js";
import { createSession, rotateSession, resolveSession } from "./session.js";
import { isBlocked, tryConsumeRate } from "./store.js";

// Public app config served to the browser on startup (no session required).
const AMAZON_ASSOCIATE_TAG = process.env.AMAZON_ASSOCIATE_TAG || "";

function requireSession(sessionKey) {
  const s = resolveSession(sessionKey);
  if (!s) throw new ConnectError("Invalid or expired session — sign in again", Code.Unauthenticated);
  return s;
}
function wrap(e) { return e instanceof ConnectError ? e : new ConnectError(String(e && e.message ? e.message : e), Code.Internal); }
function tokenEqual(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
function bearerFrom(context) {
  const h = context && context.requestHeader;
  const raw = h && typeof h.get === "function" ? h.get("authorization") : "";
  const m = String(raw || "").trim().match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
export function directSubmitUser(context, env = process.env) {
  const supplied = bearerFrom(context);
  if (!supplied) return null;
  const expected = String(env.DIRECT_SUBMIT_BEARER_TOKEN || "").trim();
  if (!expected) throw new ConnectError("Direct guide submit bearer token is not configured", Code.FailedPrecondition);
  if (expected.length < 32) throw new ConnectError("DIRECT_SUBMIT_BEARER_TOKEN must be at least 32 characters", Code.FailedPrecondition);
  if (!tokenEqual(supplied, expected)) throw new ConnectError("Invalid direct guide submit bearer token", Code.Unauthenticated);
  const email = String(env.DIRECT_SUBMIT_AUTHOR_EMAIL || "").trim();
  if (!email) throw new ConnectError("DIRECT_SUBMIT_AUTHOR_EMAIL is required for direct guide submit audit identity", Code.FailedPrecondition);
  return { email, name: String(env.DIRECT_SUBMIT_AUTHOR_NAME || "").trim() };
}

export async function startSession(req) {
  const provider = req.provider || "google";
  const strategy = getStrategy(provider);
  const idToken = provider === "apple" ? req.appleIdToken : req.googleIdToken;
  const user = await strategy.verify(idToken);
  const s = createSession(user.email, user.name);
  return { sessionKey: s.key, email: s.email, expiresAt: String(s.exp) };
}

export async function refreshSession(req) {
  const s = rotateSession(req.sessionKey);
  if (!s) throw new ConnectError("Session expired — sign in again", Code.Unauthenticated);
  return { sessionKey: s.key, email: s.email, expiresAt: String(s.exp) };
}

// Shared guard: resolve session, silently drop untrusted users, enforce rate limit.
function guard(sessionKey) {
  const user = requireSession(sessionKey);
  if (isBlocked(user.email)) return { user, silent: true };
  const rl = tryConsumeRate(user.email);
  if (!rl.allowed) throw new ConnectError(`Please wait ${Math.ceil(rl.retryMs / 1000)}s between submissions.`, Code.ResourceExhausted);
  return { user, silent: false };
}
const RECEIVED = { ok: true, prUrl: "", prNumber: 0, message: "Submission received" };

export async function submitReview(req) {
  const { user, silent } = guard(req.sessionKey);
  const stars = Math.max(1, Math.min(5, Number(req.stars) || 0));
  const text = String(req.reviewText || "").slice(0, 2000).trim();
  if (!req.guideId) throw new ConnectError("guideId is required", Code.InvalidArgument);
  if (!text) throw new ConnectError("reviewText is required", Code.InvalidArgument);
  if (silent) { console.warn("silently dropping review from untrusted user", user.email); return RECEIVED; }
  try {
    const pr = await openReviewPR({ user, guideId: req.guideId, guideTitle: req.guideTitle || req.guideId, stars, text });
    return { ok: true, prUrl: pr.html_url, prNumber: pr.number, message: "Review PR opened" };
  } catch (e) { throw wrap(e); }
}

export async function submitRepair(req, context) {
  const directUser = directSubmitUser(context);
  const { user, silent } = directUser ? { user: directUser, silent: false } : guard(req.sessionKey);
  let guide;
  try { guide = JSON.parse(req.guideJson || ""); }
  catch (e) { throw new ConnectError("guideJson is not valid JSON", Code.InvalidArgument); }
  if (!guide || typeof guide.title !== "string" || !Array.isArray(guide.phases) || !guide.phases.length) {
    throw new ConnectError("Guide needs a title and at least one phase", Code.InvalidArgument);
  }
  if (silent) { console.warn("silently dropping repair from untrusted user", user.email); return RECEIVED; }
  try {
    const pr = await openRepairPR({ user, guide });
    return { ok: true, prUrl: pr.html_url, prNumber: pr.number, message: "Repair PR opened" };
  } catch (e) { throw wrap(e); }
}

export async function getSubmissionStatus(req) {
  const nums = (req.prNumbers || []).map(Number).filter(Boolean);
  const statuses = await getStatuses(nums);
  return { statuses };
}

// Unauthenticated: the browser fetches this on startup to pick up the Amazon
// Associate tag (stored server-side as the AMAZON_ASSOCIATE_TAG env var).
export async function getAppConfig() {
  return { amazonTag: AMAZON_ASSOCIATE_TAG };
}

// ---- Deidentified client error logging (unauthenticated, best-effort) ----
const CLIENT_ERRORS_STORE = process.env.CLIENT_ERRORS_STORE || "/app/data/client-errors.jsonl";
const CLIENT_ERR_MAX_BYTES = 5 * 1024 * 1024; // stop appending past ~5MB
let _errWindowStart = 0, _errCount = 0;
function errRateOk(now) { if (now - _errWindowStart > 60000) { _errWindowStart = now; _errCount = 0; } return (++_errCount) <= 120; }
// Backstop scrub: never persist a key/email/token/VIN even if the client missed one.
function scrubServer(s) {
  return String(s == null ? "" : s)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[KEY]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\b/g, "[TOKEN]")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[VIN]");
}
const capStr = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; };

export async function logClientError(req) {
  const now = Date.now();
  if (!errRateOk(now)) return { ok: false };
  const rec = {
    ts: Number(req.ts) || now,
    receivedAt: now,
    context: capStr(scrubServer(req.context), 40),
    route: capStr(scrubServer(req.route), 40),
    appVersion: capStr(scrubServer(req.appVersion), 40),
    userAgent: capStr(scrubServer(req.userAgent), 300),
    message: capStr(scrubServer(req.message), 500),
    stack: capStr(scrubServer(req.stack), 4000),
  };
  console.error("client-error", JSON.stringify(rec));
  try {
    let underCap = true;
    try { if (statSync(CLIENT_ERRORS_STORE).size > CLIENT_ERR_MAX_BYTES) underCap = false; } catch (e) { /* file may not exist yet */ }
    if (underCap) { mkdirSync(dirname(CLIENT_ERRORS_STORE), { recursive: true }); appendFileSync(CLIENT_ERRORS_STORE, JSON.stringify(rec) + "\n"); }
  } catch (e) { /* console.error above already captured it */ }
  return { ok: true };
}
