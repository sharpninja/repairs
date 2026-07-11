# repairs-submit-service

A small **gRPC / Connect** service (Node, Dockerized) that turns
**Google-authenticated** submissions from the Repairs PWA into **GitHub pull
requests** against the guide catalog in the **data repo** (`sharpninja/repairs-data`,
`marketplace.json` on the **`approved`** branch — separate from the app code repo).

- The browser signs the user in with **Google Identity Services** using the
  **top-level redirect flow** (`ux_mode:"redirect"`): the page navigates to Google,
  which POSTs the **ID token** to **`POST /auth/google/callback`**. This needs no
  third-party cookies/storage, so it works under browser tracking prevention and in
  an installed PWA (the old popup flow silently closes there).
- The callback verifies the `g_csrf_token` double-submit cookie, verifies the ID
  token, mints a session, and **303-redirects back into the app** (`APP_ORIGIN`) with a
  single-use handoff code in the URL fragment. The app swaps it for its session key via
  **`POST /auth/google/redeem`**, then submits carry that key (as before).
- The service uses a **server-held GitHub credential** (a bot PAT or GitHub App) to
  branch, edit `marketplace.json`, and open a PR — attributing the submission to the
  Google user in the PR body.
- Users never see or hold a GitHub credential; a maintainer reviews and merges.

> Google Cloud Console for the redirect flow: on the same Web OAuth client, add the app
> origin to **Authorized JavaScript origins** *and* the exact callback
> `https://<backend-origin>/auth/google/callback` to **Authorized redirect URIs**.

Two RPCs (see [`proto/repairs/v1/submissions.proto`](proto/repairs/v1/submissions.proto)):

| RPC | What it does |
|-----|--------------|
| `SubmitReview` | Appends a star rating + review to an existing catalog guide, recomputes its aggregate rating, opens a PR. |
| `SubmitRepair` | Adds a full guide (the app's export JSON) as a new catalog entry, opens a PR. |

### Claude moderation of submissions (subscription CLI)

Every submission PR is moderated by **Claude via the Claude Code CLI**, authenticated
by a **Claude subscription** (a `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) —
**no Anthropic API key** is used server-side. Two paths, both idempotent:

- **Inline** — right after the service opens a PR it labels it `app-submission` and runs
  moderation (fire-and-forget; set `MODERATE_ON_SUBMIT=false` to disable).
- **Monitor** — `npm run monitor` (a second container) polls open `app-submission` PRs
  that don't yet carry an `ai:*` label and moderates any it finds — the backstop.

Moderation reads the PR's diff/title/body, asks Claude for an `approve` / `flag` / `reject`
verdict with a summary, then **posts a comment and an `ai:<verdict>` label**. Set
`AUTO_CLOSE_REJECT=true` to auto-close rejected PRs (otherwise they're just labeled). A
maintainer always makes the final merge decision.

It serves **Connect, gRPC, and gRPC-Web** on the same port, with a CORS shim so
the browser can call it cross-origin. The app calls the Connect JSON protocol
with a plain `fetch` (no client library needed).

## Configure

Copy `.env.example` to `.env` and fill it in:

1. **Google OAuth Web client** — [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   → *Create credentials* → *OAuth client ID* → *Web application*. Add your app's
   origin (e.g. `https://sharpninja.github.io`) to **Authorized JavaScript
   origins**. Put the client ID in `GOOGLE_CLIENT_ID` — and the **same** value in
   the app under **⚙️ → Community submissions → Google client ID**.
2. **GitHub credential** — a **GitHub App** (recommended) installed on the **data
   repo** `sharpninja/repairs-data` with **Contents + Pull requests + Issues =
   Read/Write**, or a fine-grained PAT with the same scopes. `./setup.ps1` can mint a
   scoped token for you; the service auto-refreshes when the `GITHUB_APP_*` vars are set.
   The data repo is bootstrapped with [`scripts/init-data-repo.ps1`](../scripts/init-data-repo.ps1).
3. **`ALLOWED_ORIGIN`** — the exact origin of your deployed PWA (or `*`).

For moderation, also set **`CLAUDE_CODE_OAUTH_TOKEN`**: on a machine logged into a
Claude Pro/Max account run `claude setup-token` and paste the token into `.env`.

Optional: **Sign in with Apple** — set **`APPLE_CLIENT_ID`** to the **Services ID** configured
for Sign in with Apple (the audience the Apple identity token must match; distinct from the iOS
app's Bundle ID). The server verifies Apple tokens against Apple's JWKS. Sign in with Apple also
requires, on the Apple Developer portal, a registered Services ID, a Sign in with Apple key, and
configured return URLs — one-time account setup the server cannot automate. Until it's set up the
client keeps using Google: `StartSession`'s `provider` field defaults to `"google"`, so existing
clients are unaffected.

Optional: set **`AMAZON_ASSOCIATE_TAG`** to your Amazon Associate tag. The app fetches it
on startup via the unauthenticated `GetAppConfig` RPC and appends it to Amazon shopping
links. Leave it blank for plain, untagged searches.

The app reports **deidentified** script errors to the unauthenticated `LogClientError` RPC.
The browser sends only an allowlist (scrubbed message/stack, route, app version, user agent,
context, timestamp) and the server scrubs again (keys, emails, tokens, VINs) before logging
to the console and appending to **`CLIENT_ERRORS_STORE`** (default `/app/data/client-errors.jsonl`,
JSONL, capped ~5MB).

### Admin dashboard

Set **`ADMIN_TOKEN`** (e.g. `openssl rand -hex 32`) and open **`/admin?token=<ADMIN_TOKEN>`**
(or send it as the `X-Admin-Token` header). The server-rendered page shows moderation status
(live open submission PRs + their `ai:*` verdict, best-effort), the persisted **moderation log**
(`MODERATION_LOG_STORE`, default `/app/data/moderation.jsonl`), the deidentified **error logs**,
and the **ban** audit log. With `ADMIN_TOKEN` unset the `/admin` route is disabled (404); a
missing/invalid token returns 401.

### Store listing URLs

Google Play Console and Apple App Store Connect require **public URLs** for the privacy policy
and terms of service during listing setup. The service serves them as plain HTML (simple `GET`,
no auth, short cache), meant to be opened directly in a browser and linked from the store consoles:

- **`GET /legal/privacy`** — privacy policy
- **`GET /legal/terms`** — terms of service

The content lives in [`legal/privacy.md`](legal/privacy.md) and [`legal/terms.md`](legal/terms.md).
With the service exposed publicly (e.g. via the ngrok tunnel), the listing URLs are
`https://<your-host>/legal/privacy` and `https://<your-host>/legal/terms`.

## Quick start (script)

```powershell
cd server
./setup.ps1          # fills .env (runs `claude setup-token` for you), then brings it up
./setup.ps1 -NoRun   # fill .env only
```

The script prompts for the Google client ID, GitHub token, and Claude subscription token
(auto-capturing it from `claude setup-token` when the CLI is present), keeps any values you
already set, then runs `docker compose up --build`. Manual steps below.

## Run with Docker

Service only:

```bash
cd server
docker build -t repairs-submit-service .
docker run --rm -p 8080:8080 --env-file .env repairs-submit-service
```

Service **+ moderation monitor** together:

```bash
cd server
docker compose up --build
```

Then in the app: **⚙️ → Community submissions** → set **Backend URL** to the
service's public URL (e.g. `https://submit.example.com`) and **Google client ID**
to the value above. The **🚀 Submit** buttons in the Marketplace and in
**Guides → Share/export** will then open PRs.

> The build generates protobuf code with `buf` (remote plugins, needs network at
> build time). The runtime image contains only production deps + generated code.

## Local smoke test (no browser)

Every submission is tagged with a **session key**. First exchange a Google ID token
(`$IDTOKEN`) for one, then submit with it:

```bash
KEY=$(curl -sS http://localhost:8080/repairs.v1.SubmissionService/StartSession \
  -H 'content-type: application/json' -d '{"googleIdToken":"'"$IDTOKEN"'"}' | jq -r .sessionKey)

curl -sS http://localhost:8080/repairs.v1.SubmissionService/SubmitReview \
  -H 'content-type: application/json' \
  -d '{"sessionKey":"'"$KEY"'","guideId":"mkt-crv-s1","guideTitle":"CR-V","stars":5,"reviewText":"Clear and safe."}'
```

A successful call returns `{"ok":true,"prUrl":"https://github.com/.../pull/123","prNumber":123,"message":"Review PR opened"}`.

### Direct operator guide submit

For trusted server-side automation, `SubmitRepair` also accepts a bearer token
instead of a Google session key. Set these only in the server/container
environment; never put the token in the PWA or browser settings:

```bash
DIRECT_SUBMIT_BEARER_TOKEN=$(openssl rand -hex 32)
DIRECT_SUBMIT_AUTHOR_EMAIL=you@example.com
DIRECT_SUBMIT_AUTHOR_NAME="Your Name"
```

Then submit a guide JSON payload directly:

```bash
curl -sS http://localhost:8788/repairs.v1.SubmissionService/SubmitRepair \
  -H "content-type: application/json" \
  -H "authorization: Bearer $DIRECT_SUBMIT_BEARER_TOKEN" \
  -d '{"guideJson":"{\"title\":\"Example\",\"phases\":[{\"name\":\"Phase 1\",\"steps\":[]}]}"}'
```

The direct bearer path is intentionally limited to guide submission
(`SubmitRepair`). Reviews still require a user session.

## Security notes

- The Google ID token audience is checked against `GOOGLE_CLIENT_ID`, and
  `email_verified` is required; submissions then carry a rotating **session key**.
- **Trust + rate limiting** are built in: submissions from users with a bad
  moderation record are silently dropped, and each user is capped at one submission
  per minute (see `store.js`).
- Direct operator guide submission requires a long bearer token and explicit audit
  identity in `DIRECT_SUBMIT_AUTHOR_EMAIL` / `DIRECT_SUBMIT_AUTHOR_NAME`.
- The server credential is the only thing that can write to the repo; prefer a
  **GitHub App** (least-privilege, auto-refreshing) and keep it scoped to the data repo.
- Submissions are **Claude-moderated** and still go through **human PR review** before
  they reach the catalog.
