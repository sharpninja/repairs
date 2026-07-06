// Service implementation: Google login -> session key; every submission is
// tagged with the session key, rate-limited, trust-checked, then opened as a PR.
import { OAuth2Client } from "google-auth-library";
import { ConnectError, Code } from "@connectrpc/connect";
import { openReviewPR, openRepairPR, getStatuses } from "./github.js";
import { createSession, rotateSession, resolveSession } from "./session.js";
import { isBlocked, tryConsumeRate } from "./store.js";

const googleClient = new OAuth2Client();

async function verifyGoogle(idToken) {
  if (!idToken) throw new ConnectError("Missing Google credential", Code.Unauthenticated);
  const aud = process.env.GOOGLE_CLIENT_ID;
  if (!aud) throw new ConnectError("Server is missing GOOGLE_CLIENT_ID", Code.FailedPrecondition);
  let ticket;
  try { ticket = await googleClient.verifyIdToken({ idToken, audience: aud }); }
  catch (e) { throw new ConnectError("Invalid Google credential", Code.Unauthenticated); }
  const p = ticket.getPayload();
  if (!p || !p.email_verified) throw new ConnectError("Unverified Google account", Code.PermissionDenied);
  return { email: p.email, name: p.name || "", sub: p.sub };
}

function requireSession(sessionKey) {
  const s = resolveSession(sessionKey);
  if (!s) throw new ConnectError("Invalid or expired session — sign in again", Code.Unauthenticated);
  return s;
}
function wrap(e) { return e instanceof ConnectError ? e : new ConnectError(String(e && e.message ? e.message : e), Code.Internal); }

export async function startSession(req) {
  const user = await verifyGoogle(req.googleIdToken);
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

export async function submitRepair(req) {
  const { user, silent } = guard(req.sessionKey);
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
