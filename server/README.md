# repairs-submit-service

A small **gRPC / Connect** service (Node, Dockerized) that turns
**Google-authenticated** submissions from the Repairs PWA into **GitHub pull
requests** against the guide catalog ([`docs/marketplace.json`](../docs/marketplace.json)).

- The browser signs the user in with **Google Identity Services** and sends the
  Google **ID token** with the payload.
- The service **verifies the ID token**, then uses a **server-held GitHub
  credential** (a bot PAT or GitHub App) to branch, edit `marketplace.json`, and
  open a PR — attributing the submission to the Google user in the PR body.
- Users never see or hold a GitHub credential; a maintainer reviews and merges.

Two RPCs (see [`proto/repairs/v1/submissions.proto`](proto/repairs/v1/submissions.proto)):

| RPC | What it does |
|-----|--------------|
| `SubmitReview` | Appends a star rating + review to an existing catalog guide, recomputes its aggregate rating, opens a PR. |
| `SubmitRepair` | Adds a full guide (the app's export JSON) as a new catalog entry, opens a PR. |

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
2. **GitHub credential** — a fine-grained PAT scoped to the repo with **Contents**
   and **Pull requests** = Read/Write (or a GitHub App installation token) in
   `GITHUB_TOKEN`.
3. **`ALLOWED_ORIGIN`** — the exact origin of your deployed PWA (or `*`).

## Run with Docker

```bash
cd server
docker build -t repairs-submit-service .
docker run --rm -p 8080:8080 --env-file .env repairs-submit-service
```

Then in the app: **⚙️ → Community submissions** → set **Backend URL** to the
service's public URL (e.g. `https://submit.example.com`) and **Google client ID**
to the value above. The **🚀 Submit** buttons in the Marketplace and in
**Guides → Share/export** will then open PRs.

> The build generates protobuf code with `buf` (remote plugins, needs network at
> build time). The runtime image contains only production deps + generated code.

## Local smoke test (no browser)

With the service running and a valid Google ID token in `$TOKEN`:

```bash
curl -sS http://localhost:8080/repairs.v1.SubmissionService/SubmitReview \
  -H 'content-type: application/json' \
  -d '{"googleIdToken":"'"$TOKEN"'","guideId":"mkt-crv-s1","guideTitle":"CR-V","stars":5,"reviewText":"Clear and safe."}'
```

A successful call returns `{"ok":true,"prUrl":"https://github.com/.../pull/123","prNumber":123,"message":"Review PR opened"}`.

## Security notes

- The ID token audience is checked against `GOOGLE_CLIENT_ID`, and
  `email_verified` is required.
- The server credential is the only thing that can write to the repo; keep it
  scoped to this one repo and rotate it if leaked.
- Submissions still go through **human PR review** before they reach the catalog,
  and the app AI-moderates review text client-side before submission. Consider
  adding rate limiting / an allowlist if you expose this publicly.
