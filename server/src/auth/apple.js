// Sign in with Apple strategy: verify an Apple identity token against Apple's
// published JWKS (https://appleid.apple.com/auth/keys).
//
// Apple never puts the user's name in the JWT; it sends it once, on the first
// authorization, as a separate JSON payload the client forwards. So `name` is
// an optional argument here and empty by default until the client forwards it.
import { createRemoteJWKSet, createLocalJWKSet, jwtVerify } from "jose";
import { ConnectError, Code } from "@connectrpc/connect";

const APPLE_ISS = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

// Lazily-created remote key set. jose caches fetched keys and rate-limits
// refetches (cooldown), so this is the small in-memory cache the spec calls for.
let _jwks = null;
function jwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(APPLE_JWKS_URL, { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30 * 1000 });
  return _jwks;
}

// Test seam: inject a plain JWKS object ({ keys: [...] }) so tests verify
// against an in-test keypair and never touch the network. Pass null to reset.
export function __setJwksForTest(jwksObject) { _jwks = jwksObject ? createLocalJWKSet(jwksObject) : null; }

/** @returns {Promise<import("./strategy.js").AuthUser>} */
export async function verify(idToken, name) {
  if (!idToken) throw new ConnectError("Missing Apple credential", Code.Unauthenticated);
  const aud = process.env.APPLE_CLIENT_ID;
  if (!aud) throw new ConnectError("Server is missing APPLE_CLIENT_ID", Code.FailedPrecondition);
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks(), { issuer: APPLE_ISS, audience: aud, algorithms: ["RS256"] }));
  } catch (e) {
    throw new ConnectError("Invalid Apple credential", Code.Unauthenticated);
  }
  if (!payload || !payload.sub) throw new ConnectError("Invalid Apple credential", Code.Unauthenticated);
  // Parity with Google: if Apple included an email, it must be verified. Apple
  // sends email_verified as a boolean or the string "true". Apple may omit email
  // on later sign-ins or if the user declined to share it; that is allowed here
  // (the stable identifier is `sub`).
  if (payload.email && !(payload.email_verified === true || payload.email_verified === "true")) {
    throw new ConnectError("Unverified Apple account", Code.PermissionDenied);
  }
  return { email: payload.email || "", name: name || "", sub: payload.sub, provider: "apple" };
}
