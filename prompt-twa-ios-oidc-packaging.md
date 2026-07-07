# Prompt: TWA/iOS packaging scripts, store legal endpoints, and multi-provider OIDC

Paste this to Claude Code (or another coding agent) inside the `repairs` repo checkout.

---

## Context

`sharpninja/repairs` is an offline-first PWA (`docs/index.html`) plus a Node "submit
service" (`server/`) that turns app submissions into GitHub PRs. Auth today is
Google-only: the client gets a Google ID token from Google Identity Services, sends it
to `StartSession`, and `server/src/impl.js` verifies it inline with `google-auth-library`.
Scripts in this repo are PowerShell 7 (`scripts/init-data-repo.ps1`, `tests/run.ps1`,
`server/setup.ps1`) — follow that convention for anything new.

Do three things, as separate, independently-testable changes:

1. Add PS7 scripts that package the PWA for Google Play (TWA) and the Apple App Store.
2. Add HTTPS endpoints on the submit service that serve the privacy policy and terms of
   service, since both stores require public URLs for these during listing setup.
3. Refactor the server's OIDC handling from "Google, hardcoded" into a provider strategy,
   and add an Apple Sign In strategy alongside the existing Google one.

Do not touch `docs/index.html`'s client-side sign-in UI in this pass — flag what client
changes will eventually be needed (see "Follow-on work" at the end) but keep this change
server- and tooling-only unless told otherwise.

---

## Task 1 — Packaging scripts (`scripts/`)

Add three PowerShell 7 scripts, matching the existing style in `scripts/init-data-repo.ps1`
(param blocks, `#Requires -Version 7`, clear `Write-Host` progress, non-zero exit on
failure):

### `scripts/package-android.ps1`
- Params: `-Domain` (e.g. `sharpninja.github.io/repairs`), `-PackageId`
  (e.g. `dev.sharpninja.repairs`), `-KeystorePath`, `-KeystorePassword` (SecureString),
  `-Output` (default `dist/android`).
- Uses `@bubblewrap/cli` (invoke via `npx`) to generate and build a Trusted Web Activity
  from `docs/manifest.webmanifest`.
- Also **writes `docs/.well-known/assetlinks.json`** with the SHA-256 cert fingerprint
  from the keystore, so Google can verify domain ↔ app ownership. Fail loudly if the
  keystore doesn't exist yet and print the `keytool`/bubblewrap command to create one —
  don't silently generate a throwaway keystore for a release build.
- Verify prerequisites up front (Node, a JDK on PATH) and exit with a clear message
  naming the missing dependency, rather than letting bubblewrap fail deep in its own output.
- End state: a signed `.aab` under `-Output`, ready for Play Console upload.

### `scripts/package-ios.ps1`
- Params: `-Domain`, `-BundleId` (e.g. `dev.sharpninja.repairs`), `-AppName`,
  `-Output` (default `dist/ios`).
- Detect host OS; if not macOS, print a clear error that Xcode build/archive/upload steps
  require running the back half of this script on a Mac, but still allow the *project
  generation* step to run cross-platform if the tool supports it.
- Generate the Xcode project via PWABuilder's iOS platform (CLI or REST call to
  pwabuilder.com's packaging API) from `docs/manifest.webmanifest`.
- Print the manual follow-up steps (open in Xcode, set signing team, archive, upload via
  Transporter/Xcode Organizer) since those can't be scripted from PowerShell alone.

### `scripts/package-apps.ps1`
- Thin orchestrator: `-Platform Android|iOS|Both`, forwards to the two scripts above with
  shared params (`-Domain`, common output root), and prints a final summary table of what
  was produced and where.

Update `README.md`'s repo-layout table and `server/README.md` (if relevant) to mention
the new `scripts/package-*.ps1` and what each produces.

---

## Task 2 — Legal endpoints on the submit service

Add two new files:

- `server/legal/privacy.md` — privacy policy content. Must accurately describe: photos/
  voice/video captured on-device and stored only in IndexedDB (never uploaded); the
  user-supplied Anthropic API key (stored only in-browser, used to call
  `api.anthropic.com` directly); Google Sign-In today, Apple Sign In once Task 3 ships;
  the GitHub PR submission flow (email/name attached to submissions).
- `server/legal/terms.md` — basic terms of service (acceptable use, no warranty, DIY
  repair disclaimer given the safety-critical nature of the guides).

Add `server/src/legal.js` exporting a small handler that reads and serves these files as
HTML (a minimal Markdown→HTML render is fine; no new heavy dependency needed — a small,
dependency-free converter or a single lightweight lib is acceptable, your call).

Wire into `server/src/server.js` alongside the existing `/health` check, **before** the
Connect adapter, for:
- `GET /legal/privacy`
- `GET /legal/terms`

Both should be simple `GET`, no auth, cached with a short `Cache-Control`, and unaffected
by the existing CORS allowlist (these are meant to be opened directly in a browser and
linked from Play Console / App Store Connect, not called by the app).

Document the two URLs in `server/README.md` under a new "Store listing URLs" section, and
add a link/footer to `docs/index.html` if there's an obvious existing footer area (small,
low-risk addition — skip if it requires restructuring the layout).

---

## Task 3 — OIDC provider strategy (Google + Apple)

### Proto (`server/proto/repairs/v1/submissions.proto`)
Change `StartSessionRequest` to be provider-aware without breaking existing clients:

```proto
message StartSessionRequest {
  // "google" or "apple". Defaults to "google" if empty, for backward compatibility
  // with clients still setting only google_id_token.
  string provider = 1;
  // Google Identity Services ID token (JWT) from the browser. Used when provider == "google".
  string google_id_token = 2;
  // Sign in with Apple identity token (JWT) from the browser. Used when provider == "apple".
  string apple_id_token = 3;
}
```
Keep field numbers for `google_id_token` stable if easily done to avoid a wire-breaking
change; adding `provider` and `apple_id_token` as new fields is additive and safe. Run
`npm run generate` in `server/` after editing and commit the regenerated `server/gen/`
output per the existing convention (never hand-edit generated code).

### New `server/src/auth/` module
- `server/src/auth/strategy.js` — documents the contract only (JSDoc), no runtime code
  needed beyond maybe a shared error helper: a strategy exposes
  `async verify(idToken) -> { email, name, sub, provider }` and throws a `ConnectError`
  with `Code.Unauthenticated` on failure.
- `server/src/auth/google.js` — move the existing `verifyGoogle` logic from `impl.js`
  here verbatim, matching the contract above (add `provider: "google"` to the returned
  object). Keep using `google-auth-library` and `GOOGLE_CLIENT_ID`.
- `server/src/auth/apple.js` — new. Verify a Sign in with Apple identity token:
  - Fetch/cache Apple's JWKS from `https://appleid.apple.com/auth/keys` (a small in-memory
    cache with a TTL is enough; no need for a persistent store).
  - Verify signature, `iss === "https://appleid.apple.com"`, and
    `aud === process.env.APPLE_CLIENT_ID` (the Services ID configured for Sign in with
    Apple, distinct from the app's Bundle ID).
  - Apple only sends the user's name on the **first** authorization (in a separate
    `user` JSON payload from the client, not in the JWT) — the client will need to
    forward that once on first sign-in; until then, treat `name` as optional/empty and
    don't throw if it's missing. Return `{ email, name: name || "", sub: payload.sub, provider: "apple" }`.
  - Use a maintained JWT/JWKS library already common in this stack's ecosystem (e.g.
    `jose`) rather than hand-rolling JWT verification.
- `server/src/auth/index.js` — a tiny registry: `getStrategy(provider)` returning the
  Google or Apple module, defaulting to `"google"` for empty/unset provider, and throwing
  `Code.InvalidArgument` for anything else.

### `server/src/impl.js`
Replace the inline `verifyGoogle` with:
```js
import { getStrategy } from "./auth/index.js";
...
export async function startSession(req) {
  const strategy = getStrategy(req.provider);
  const idToken = req.provider === "apple" ? req.appleIdToken : req.googleIdToken;
  const user = await strategy.verify(idToken);
  const s = createSession(user.email, user.name);
  return { sessionKey: s.key, email: s.email, expiresAt: String(s.exp) };
}
```
Everything downstream of `createSession` (rate limiting, trust/ban checks, PR submission)
is already provider-agnostic since it only keys off `email` — leave `store.js`/`session.js`
untouched.

### Env / config
Document new env vars in `server/README.md` and `.env.example`:
- `APPLE_CLIENT_ID` — the Services ID used for Sign in with Apple (not the iOS app's
  Bundle ID).
- Note that Sign in with Apple also requires, on the Apple Developer portal side, a
  registered Services ID, a Sign in with Apple key, and configured return URLs — this is
  account setup, not something the server script can automate.

### Tests
- Add unit coverage under `tests/` (or extend `tests/store.test.mjs` if that's the
  right home) for `getStrategy`, the Google-default-when-empty behavior, and Apple JWKS
  verification with a mocked/fixture JWKS response and a signed test JWT. Don't make live
  network calls to `appleid.apple.com` in tests.
- Confirm `tests/integration.test.mjs` still passes unmodified for the Google flow (it
  should, since `provider` defaults to `"google"`).

---

## Acceptance criteria

- [ ] `./tests/run.ps1` passes.
- [ ] `curl localhost:$PORT/legal/privacy` and `/legal/terms` return 200 + readable HTML.
- [ ] Existing Google sign-in flow works with **no client changes** (backward compatible).
- [ ] A crafted Apple identity token (test fixture) is accepted by the new strategy; an
      invalid signature or wrong audience is rejected with `Code.Unauthenticated`.
- [ ] `npm run generate` was run after the proto change and `server/gen/` is committed.
- [ ] No secrets (API keys, keystore passwords) are hardcoded or logged.
- [ ] `scripts/package-android.ps1 -WhatIf`-style dry checks (missing keystore, missing
      Node/JDK) fail with a clear, actionable message rather than a stack trace.

## Follow-on work (explicitly out of scope for this pass)

Per this repo's `AGENTS.md`/`CLAUDE.md` convention, TODO tracking goes through the MCP
Server (`/mcpserver/todo`), not a markdown checklist. If the MCP Server is available in
your session, register each item below as its own TODO (title + description as shown)
instead of, or in addition to, leaving them here as prose. If the MCP Server is not
available, say so explicitly and leave them tracked here until it is.

- **TODO: Wire Sign in with Apple into the client UI** —
  `docs/index.html` client changes: add the "Sign in with Apple" JS SDK button next to
  the existing Google button, send `provider: "apple"` + `apple_id_token` on
  `StartSession`, and forward the one-time `user` name payload Apple provides on first
  auth.
- **TODO: Update CSP for Sign in with Apple** —
  CSP update: `docs/index.html`'s `connect-src` will need `appleid.apple.com` added once
  the client integrates Sign in with Apple JS.
- **TODO: Register Sign in with Apple in the Apple Developer portal** —
  Registering the Sign in with Apple Services ID/key in the Apple Developer portal (manual,
  one-time account setup — see the earlier app-store-launch-checklist for the broader
  Apple enrollment steps).
