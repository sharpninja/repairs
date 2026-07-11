// Unit tests for the direct operator guide-submit bearer token path.
//   node tests/direct-submit-auth.test.mjs
import assert from "node:assert/strict";

const { directSubmitUser } = await import("../server/src/impl.js");

let pass = 0;
const t = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };
function ctx(auth) {
  return { requestHeader: { get: (name) => name.toLowerCase() === "authorization" ? auth : "" } };
}
function errOf(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

console.log("direct guide submit auth");
{
  const env = { DIRECT_SUBMIT_BEARER_TOKEN: "a".repeat(64), DIRECT_SUBMIT_AUTHOR_EMAIL: "ninja@thesharp.ninja", DIRECT_SUBMIT_AUTHOR_NAME: "Sharp Ninja" };
  t("missing Authorization header does not trigger direct auth", directSubmitUser(ctx(""), env) === null);
  const user = directSubmitUser(ctx(`Bearer ${"a".repeat(64)}`), env);
  t("valid bearer returns configured audit identity", user.email === "ninja@thesharp.ninja" && user.name === "Sharp Ninja");
}
{
  const env = { DIRECT_SUBMIT_BEARER_TOKEN: "a".repeat(64), DIRECT_SUBMIT_AUTHOR_EMAIL: "ninja@thesharp.ninja" };
  const err = errOf(() => directSubmitUser(ctx(`Bearer ${"b".repeat(64)}`), env));
  t("wrong bearer token is rejected", err && /Invalid direct guide submit bearer token/.test(err.message));
}
{
  const env = { DIRECT_SUBMIT_BEARER_TOKEN: "short", DIRECT_SUBMIT_AUTHOR_EMAIL: "ninja@thesharp.ninja" };
  const err = errOf(() => directSubmitUser(ctx("Bearer short"), env));
  t("configured bearer token must be long", err && /at least 32 characters/.test(err.message));
}
{
  const env = { DIRECT_SUBMIT_BEARER_TOKEN: "a".repeat(64) };
  const err = errOf(() => directSubmitUser(ctx(`Bearer ${"a".repeat(64)}`), env));
  t("audit email is required for direct auth", err && /audit identity/.test(err.message));
}

console.log(`\n${pass} assertions passed.`);
