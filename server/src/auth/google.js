// Google Sign-In strategy: verify a Google Identity Services ID token.
// Moved verbatim from impl.js's inline verifyGoogle, now returning provider.
import { OAuth2Client } from "google-auth-library";
import { ConnectError, Code } from "@connectrpc/connect";

const client = new OAuth2Client();

/** @returns {Promise<import("./strategy.js").AuthUser>} */
export async function verify(idToken) {
  if (!idToken) throw new ConnectError("Missing Google credential", Code.Unauthenticated);
  const aud = process.env.GOOGLE_CLIENT_ID;
  if (!aud) throw new ConnectError("Server is missing GOOGLE_CLIENT_ID", Code.FailedPrecondition);
  let ticket;
  try { ticket = await client.verifyIdToken({ idToken, audience: aud }); }
  catch (e) { throw new ConnectError("Invalid Google credential", Code.Unauthenticated); }
  const p = ticket.getPayload();
  if (!p || !p.email_verified) throw new ConnectError("Unverified Google account", Code.PermissionDenied);
  return { email: p.email, name: p.name || "", sub: p.sub, provider: "google" };
}
