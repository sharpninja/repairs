# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## First step in every new session: run `/add-profile`

Before any other work, run the `add-profile` skill. It loads the global operator profile from `~/.claude/profile/` (identity + standing feedback). After loading, state in one line the behavioral boundaries it puts you under for the rest of the session, so both you and the operator can see the constraints you are operating within. At minimum these are:

- **Accuracy first; if unsure, ask.** Read facts from the authoritative artifact (file/DB/plugin), never a stale marker or cache. Mark observation vs inference. Concede errors immediately.
- **Bring the receipts.** Every "done/fixed/passes" claim ships with machine-verifiable evidence (command output + exit code, on-disk grep/diff, store-query result, exact test counts). Verify before asserting.
- **Approve before execute.** Produce decision-complete plans (scope, blast radius, breaking-change flag) and get an explicit go before editing.
- **No em-dashes or en-dashes** anywhere (except numeric ranges): use hyphen, colon, period, semicolon, or parentheses.
- **Never invoke a shell directly; always use PowerShell via the PowerShell MCP (`PowerShell.mcp` / the `mcp__pwsh__*` tools).** Bash is not approved for running scripts: always target `pwsh` (`pwsh.exe -NoProfile -NonInteractive`). Never Node for JSON/YAML; build payloads from native objects and serialize. No table-style output.
- **Batch elevated commands into a single script.** When multiple commands need admin/`gsudo` rights, write them to one temporary `.ps1` and run it with a single elevated call so UAC is not prompted repeatedly. Delete the script afterward.
- **Never deploy or bind anything to port 8080** on this machine: it is never available. The submit service defaults to `8080` (`.env.example` `PORT`, `docker-compose.yml` `8080:8080`, `server/src/server.js`); override to a free port (set `PORT` and map the host port accordingly) before running it locally.
- **MCP Server is the only interface** to TODO and session-log storage; never read or write those files directly.
- **Prefix every reply with the response-timestamp.**
- **Source control:** Azure DevOps `origin` is primary; never push the github remote or use `gh` unless explicitly asked. Note this repo is a GitHub-native exception (Pages + `repairs-data` PRs + GitHub App), so GitHub operations here are in-scope for the deploy work but still confirmed before any push.

## Read AGENTS-README-FIRST.yaml first

At the start of any session in this workspace, read `AGENTS-README-FIRST.yaml` (repo root, git-ignored). It is the MCP Server agent config for this workspace and provides:

- `baseUrl` + `apiKey` (`X-Api-Key`) for the MCP Server REST API.
- `endpoints` for the TODO API (`/mcpserver/todo`), session-log API (`/mcpserver/sessionlog`), context search/pack, repo, GitHub, and workspace tools.
- `workspace` / `workspacePath` identifying this repo to the server.

All TODO and session-log work MUST go through the MCP Server (REST API, MCP tools, `mcpserver-repl`, the `McpTodo.psm1` / `McpSession.psm1` helpers, or the Director CLI). **Never read or write `docs/todo.yaml` or any session-log file directly** with Read/Edit/Write/Grep/cat: the MCP Server is the only allowed interface. `docs/todo.yaml` is the server's storage file; treat it as off-limits.

## What this is

An offline-first, phone-first **Progressive Web App** for DIY vehicle repair, plus an **optional** backend that turns app submissions into GitHub pull requests. The app is a single self-contained static file with **no build step and no dependencies**. Read `README.md` for the full feature tour and `server/README.md` for backend deployment.

## Two-repo code/data split

- **`sharpninja/repairs`** (this repo): the app (`docs/`), the submit service (`server/`), tests, scripts. Ships a bundled seed catalog at `docs/marketplace.json` for offline first-load.
- **`sharpninja/repairs-data`**: the published catalog, living on its **`approved`** branch. The app reads it live from `raw.githubusercontent.com/sharpninja/repairs-data/approved/marketplace.json`. Community submissions open PRs against `approved`; **merging a PR publishes** to what every app reads, with no app redeploy.

When editing catalog logic, remember the runtime data source is the *other* repo's `approved` branch; `docs/marketplace.json` here is only the offline seed/fallback.

## Common commands

**Run the app locally** (needs a secure context for camera/mic/install/service worker; `file://` will not work):
```bash
cd docs && python3 -m http.server 8099   # http://localhost:8099/
```

**Tests** (backend store/session unit tests + headless client<->server integration tests):
```powershell
./tests/run.ps1
```
Run one suite directly: `node tests/store.test.mjs` or `node tests/integration.test.mjs`. The integration tests need a Playwright-managed Chromium; `run.ps1` sets `NODE_PATH` to a global install if one is present, else set `NODE_PATH` yourself or `npx playwright install chromium`.

**Backend service** (`server/`, ES modules, Node):
```bash
cd server
npm run generate        # buf generate -> server/gen/ (needs network: remote buf plugins)
npm start               # node src/server.js  (Connect + gRPC + gRPC-Web; PORT from env, default 8788)
npm run monitor         # node src/monitor.js  (moderation backstop poller)
npm run bans            # print the ban audit log (receipts) for review
docker compose up --build   # submit + monitor + ngrok, shared data volume (host port ${PORT}, default 8788)
./setup.ps1             # interactive .env setup, then compose up
```
Generated protobuf code lands in `server/gen/` (git-ignored, regenerated by `buf`); never hand-edit it. The proto source is `server/proto/repairs/v1/submissions.proto`.

**Bootstrap the data repo** (needs `gh auth login`):
```powershell
./scripts/init-data-repo.ps1 -Owner sharpninja -Repo repairs-data -Seed docs/marketplace.json
```

Scripts in this repo are **PowerShell (`.ps1`)**, not bash.

## App architecture (`docs/index.html`)

The entire app is one file (~1700 lines): HTML shell + inline CSS + one inline `<script>`. There is no module system or bundler. The script is organized into clearly labelled sections (search for `================= NAME =================`): THEME, CONTENT MODEL, TOOLS & PARTS, GUIDES, inventory, VEHICLES, STATE, IndexedDB media, PROGRESS, ROUTER, CAPTURE, CLAUDE HELPER, VIN reading, MARKETPLACE, Google sign-in / submit, HANDS-FREE VOICE, NEW REPAIR, BOOT. When adding a feature, follow the existing section pattern and its terse coding style.

Key architectural facts:

- **Safe-by-construction rendering.** Generated *and imported* guides are rendered through a typed-block renderer (block types: `steps`, `check`, `danger`, `crit`, `tip`, `spec`, `note`). The model/JSON never yields raw HTML: any `html` field is ignored, phase colors are sanitized to hex, all text is escaped. Preserve this invariant. Never introduce a path that injects model- or import-supplied strings as HTML. The trust boundary is `createGuide` (every untrusted load: import, marketplace install, New Repair, merge funnels through it): it strips `s.html` and hex-sanitizes `p.color`. Defense-in-depth: `esc` escapes `& < > " '`, colors pass `hexc` at the render sink, and a strict **CSP `<meta>`** in `index.html` pins `connect-src` (api.anthropic.com, accounts.google.com, raw.githubusercontent.com, the backend) so an XSS can't exfiltrate the user's Anthropic key. Update the CSP `connect-src` backend entry when the backend origin changes. The guide JSON shape is documented in the "New Repair" data-format section of `README.md`.
- **On-device storage.** Progress, guides, inventory, vehicles/VIN, reviews, session, and settings live in `localStorage`; captured media (photos/voice/video) lives in **IndexedDB** (`crv-media`). Nothing is uploaded. Inventory rule: **tools are tracked globally** across guides (stable library ids), **parts are tracked per guide**.
- **Only two network destinations.** Everything works offline except (a) the Claude features (Ask Claude, hands-free voice, New Repair, read-VIN OCR) which call `api.anthropic.com` directly from the browser with the user's own key via the `anthropic-dangerous-direct-browser-access` header, and (b) reading the catalog + the optional submit backend. Do not add other network calls to the offline core.
- **Service worker (`docs/sw.js`)** precaches the app shell for offline use. The cache name is versioned (`CACHE = "crv-s1-v3"`). **Bump this version whenever you change precached shell files** or old clients will serve stale assets. `api.anthropic.com` is always fetched live and never cached.
- **Standardized tool library.** Tools carry stable `id`s so the same tool reads as "owned" across differently-worded guides; New Repair asks Claude to reuse those ids, and import canonicalizes known ids to library names.
- **All paths are relative** so the app runs correctly under the GitHub Pages `/<repo>/` subpath. Do not hardcode absolute app paths.

## Backend architecture (`server/`)

A small **Connect / gRPC / gRPC-Web** Node service (one port, CORS shim so the browser can call it cross-origin). Flow: browser signs in with **Google Identity Services** and sends the Google ID token; the service verifies it and mints a rotating **session key**; every submission carries that key. Submissions edit `marketplace.json` on a new branch of the data repo and open a **PR**, attributed to the Google user. Users never hold a GitHub credential.

- `server.js`: HTTP + CORS + health check, mounts the Connect adapter.
- `routes.js` -> `impl.js`: the five RPCs (`StartSession`, `RefreshSession`, `SubmitReview`, `SubmitRepair`, `GetSubmissionStatus`). `impl.js` holds the Google verification, the `guard()` (session + trust + rate-limit gate), and input validation.
- `github.js`: branch-off-`approved`, edit `marketplace.json`, open the PR (prefers GitHub App installation auth, falls back to `GITHUB_TOKEN`), then label + fire-and-forget moderation.
- `moderate.js`: moderates a PR by shelling out to the **Claude Code CLI** (`claude -p`, run with `--disallowedTools` so a malicious diff can't induce actions), authenticated by a **Claude subscription** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) - **no Anthropic API key server-side**. Posts an `approve`/`flag`/`reject` comment + `ai:<verdict>` label; a human still merges. The prompt treats the submission as untrusted data and detects **prompt-injection**: on detection it returns `promptInjection:true`, which **immediately hard-bans the submitter** (`banUser`), labels the PR `prompt-injection`, and closes it.
- `store.js` / `session.js`: file-backed (JSON on a mounted volume), single-process. `store.js` does trust scoring + rate limiting (default 1 submission/min, block at score <= -4), plus `banUser`/`listBans`: an **immediate hard ban + append-only audit log** (`BANS_STORE`, default `/app/data/bans.json`) carrying receipts (email, PR #/URL, verdict, timestamp) for maintainer review via `npm run bans`. `session.js` mints/rotates/resolves session keys. These are **not** concurrency-safe across replicas: run one submit instance or swap in a real KV to scale.
- `monitor.js`: the backstop poller that moderates any open `app-submission` PR lacking an `ai:*` label (in case inline moderation was missed).

Behavior is driven by env vars (see `server/README.md` and defaults in each source file): `GOOGLE_CLIENT_ID`, `GITHUB_APP_*` / `GITHUB_TOKEN`, `GITHUB_OWNER`/`REPO`/`BASE`, `CLAUDE_CODE_OAUTH_TOKEN`, `MODERATE_ON_SUBMIT`, `AUTO_CLOSE_REJECT`, `BANS_STORE`, `NGROK_AUTHTOKEN`, etc. `ALLOWED_ORIGIN` is a comma-separated CORS allowlist (matching request Origin echoed back) or `*`.

**docker-compose** runs three containers: `submit` (host port from `${PORT}` in `.env`, default 8788, never 8080), `monitor`, and `ngrok` (public HTTPS tunnel to `submit`, reserved domain `sharpninja.ngrok.app`, web inspector on `:4040`; needs `NGROK_AUTHTOKEN`). The Dockerfile build stage installs `ca-certificates` (base `node:22-slim` ships none, which breaks `buf generate`'s TLS to buf.build).

## Guide slideshow (`guide/`)

The built-in CR-V guide also exists as a standalone slideshow (`crv-session1.html`) and printable PDF (`crv-session1.pdf`). Regenerate the PDF with the Playwright script:
```bash
cd guide && NODE_PATH=$(npm root -g) node render-pdf.js crv-session1.html crv-session1.pdf
```
