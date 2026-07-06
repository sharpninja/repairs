// Service implementation: verify the Google ID token, then open the PR.
import { OAuth2Client } from "google-auth-library";
import { ConnectError, Code } from "@connectrpc/connect";
import { openReviewPR, openRepairPR } from "./github.js";

const googleClient = new OAuth2Client();

async function verifyGoogle(idToken) {
  if (!idToken) throw new ConnectError("Missing Google credential", Code.Unauthenticated);
  const aud = process.env.GOOGLE_CLIENT_ID;
  if (!aud) throw new ConnectError("Server is missing GOOGLE_CLIENT_ID", Code.FailedPrecondition);
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken, audience: aud });
  } catch (e) {
    throw new ConnectError("Invalid Google credential", Code.Unauthenticated);
  }
  const p = ticket.getPayload();
  if (!p || !p.email_verified) throw new ConnectError("Unverified Google account", Code.PermissionDenied);
  return { email: p.email, name: p.name || "", sub: p.sub };
}

function wrap(e) {
  if (e instanceof ConnectError) return e;
  return new ConnectError(String(e && e.message ? e.message : e), Code.Internal);
}

export async function submitReview(req) {
  const user = await verifyGoogle(req.googleIdToken);
  const stars = Math.max(1, Math.min(5, Number(req.stars) || 0));
  const text = String(req.reviewText || "").slice(0, 2000).trim();
  if (!req.guideId) throw new ConnectError("guideId is required", Code.InvalidArgument);
  if (!text) throw new ConnectError("reviewText is required", Code.InvalidArgument);
  try {
    const pr = await openReviewPR({ user, guideId: req.guideId, guideTitle: req.guideTitle || req.guideId, stars, text });
    return { ok: true, prUrl: pr.html_url, prNumber: pr.number, message: "Review PR opened" };
  } catch (e) {
    throw wrap(e);
  }
}

export async function submitRepair(req) {
  const user = await verifyGoogle(req.googleIdToken);
  let guide;
  try {
    guide = JSON.parse(req.guideJson || "");
  } catch (e) {
    throw new ConnectError("guideJson is not valid JSON", Code.InvalidArgument);
  }
  if (!guide || typeof guide.title !== "string" || !Array.isArray(guide.phases) || !guide.phases.length) {
    throw new ConnectError("Guide needs a title and at least one phase", Code.InvalidArgument);
  }
  try {
    const pr = await openRepairPR({ user, guide });
    return { ok: true, prUrl: pr.html_url, prNumber: pr.number, message: "Repair PR opened" };
  } catch (e) {
    throw wrap(e);
  }
}
