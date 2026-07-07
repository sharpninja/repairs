// Unit tests for the OIDC provider strategy (Google default + Apple Sign In).
// No network: an in-test RSA keypair + hand-built JWTs stand in for Apple's JWKS.
//   node tests/auth.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";

const { getStrategy } = await import("../server/src/auth/index.js");
const { Code } = await import("../server/src/auth/strategy.js");
const google = await import("../server/src/auth/google.js");
const apple = await import("../server/src/auth/apple.js");

let pass = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };
async function rejectsCode(fn, code, name) {
  let err; try { await fn(); } catch (e) { err = e; }
  t(name, !!err && err.code === code);
}

// ---- JWT/JWKS helpers (node:crypto only; no jose in the test) ----
const b64url = (b) => Buffer.from(b).toString("base64url");
function keypair() { return crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }); }
function jwkOf(publicKey, kid) { return { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }; }
function signJwt(privateKey, kid, claims) {
  const header = { alg: "RS256", typ: "JWT", kid };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, ...claims };
  const input = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), privateKey);
  return input + "." + b64url(sig);
}

console.log("auth — getStrategy registry");
t("empty provider defaults to google", getStrategy("") === google);
t("undefined provider defaults to google", getStrategy(undefined) === google);
t("'google' -> google strategy", getStrategy("google") === google);
t("'apple' -> apple strategy", getStrategy("apple") === apple);
t("provider is case-insensitive", getStrategy("Google") === google && getStrategy("APPLE") === apple);
{
  let err; try { getStrategy("myspace"); } catch (e) { err = e; }
  t("unknown provider -> InvalidArgument", !!err && err.code === Code.InvalidArgument);
}
t("each strategy exposes async verify()", typeof google.verify === "function" && typeof apple.verify === "function");

console.log("\nauth — Apple Sign In strategy (JWKS verify)");
const APPLE_ISS = "https://appleid.apple.com";
const AUD = "app.services.id.example";
process.env.APPLE_CLIENT_ID = AUD;
const { publicKey, privateKey } = keypair();
const kid = "test-kid-1";
apple.__setJwksForTest({ keys: [jwkOf(publicKey, kid)] });

{
  const token = signJwt(privateKey, kid, { iss: APPLE_ISS, aud: AUD, sub: "apple-sub-123", email: "rider@example.com", email_verified: "true" });
  const u = await apple.verify(token);
  t("valid Apple token accepted", u.email === "rider@example.com" && u.sub === "apple-sub-123" && u.provider === "apple");
  t("name is optional (empty when not forwarded)", u.name === "");
}
{
  const token = signJwt(privateKey, kid, { iss: APPLE_ISS, aud: AUD, sub: "s", email: "a@b.com", email_verified: true });
  const u = await apple.verify(token, "Ada Lovelace");
  t("forwarded name is returned when present", u.name === "Ada Lovelace");
}
{
  // Apple may omit email on later sign-ins / if the user declined to share it.
  const u = await apple.verify(signJwt(privateKey, kid, { iss: APPLE_ISS, aud: AUD, sub: "no-email-sub" }));
  t("token without email is accepted (email empty)", u.email === "" && u.sub === "no-email-sub");
}
await rejectsCode(() => apple.verify(signJwt(privateKey, kid, { iss: APPLE_ISS, aud: AUD, sub: "s", email: "spoof@example.com", email_verified: false })), Code.PermissionDenied, "email present but unverified -> PermissionDenied");
await rejectsCode(() => apple.verify(signJwt(privateKey, kid, { iss: APPLE_ISS, aud: "someone.else", sub: "s" })), Code.Unauthenticated, "wrong audience -> Unauthenticated");
await rejectsCode(() => apple.verify(signJwt(privateKey, kid, { iss: "https://evil.example", aud: AUD, sub: "s" })), Code.Unauthenticated, "wrong issuer -> Unauthenticated");
{
  const other = keypair(); // signed with a key NOT in the JWKS
  await rejectsCode(() => apple.verify(signJwt(other.privateKey, kid, { iss: APPLE_ISS, aud: AUD, sub: "s" })), Code.Unauthenticated, "bad signature -> Unauthenticated");
}
await rejectsCode(() => apple.verify(""), Code.Unauthenticated, "missing token -> Unauthenticated");
{
  const saved = process.env.APPLE_CLIENT_ID; delete process.env.APPLE_CLIENT_ID;
  await rejectsCode(() => apple.verify(signJwt(privateKey, kid, { iss: APPLE_ISS, aud: AUD, sub: "s" })), Code.FailedPrecondition, "missing APPLE_CLIENT_ID -> FailedPrecondition");
  process.env.APPLE_CLIENT_ID = saved;
}

console.log(`\n${pass} assertions passed.`);
