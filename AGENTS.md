# Agent Instructions

## Session Start

1. Read `AGENTS-README-FIRST.yaml` in the repo root before operational work when it exists. It is git-ignored, workspace-specific, and may contain live MCP connection details and an API key. Do not copy secrets from it into logs, commits, or replies.
2. Use the marker's current `workspace`, `workspacePath`, endpoints, trust bootstrap, and agent-plugin guidance as the authority for MCP availability. If marker trust, health nonce validation, or plugin startup fails, continue the user's request without MCP and state the limitation when it matters.
3. If your runtime supports the operator profile workflow, run `add-profile` at session start and after any model or effort change, then follow the loaded behavioral boundaries.

On every subsequent user message:

1. Follow `AGENTS-README-FIRST.yaml` for MCP session, TODO, requirement, and workspace operations.
2. Complete the user's request.

## Rules

1. Complete the user's request.
2. Do not fabricate information. If you made a mistake, acknowledge it. Distinguish facts from speculation.
3. Prioritize correctness over speed. Do not ship code you have not verified compiles and is logically sound.
4. Keep this file focused on durable workspace policy and conventions. Do not duplicate live marker secrets or generated MCP operational payloads.
5. Use MCP Server, MCP tools, approved helper modules, or the active plugin for TODO and session-log work. Do not read or write `docs/todo.yaml`, MCP storage files, or session JSONL files directly.
6. Persist session-log updates after meaningful changes when MCP is available: turn creation, actions, decisions, blockers, requirements, file/context changes, and final status.
7. Scripts in this repo are PowerShell (`.ps1`). Prefer `pwsh.exe -NoProfile -NonInteractive -File <script.ps1>` for script execution.
8. Do not bind local services to port `8080` on this machine. Set `PORT` to a known free non-8080 port before running the submit service. `server/src/server.js` and `server/.env.example` currently default to `8080`, while `server/docker-compose.yml` falls back to `8788` when `PORT` is unset.
9. Use relative app paths. The PWA must work under the GitHub Pages `/<repo>/` subpath.
10. Do not hand-edit generated protobuf output in `server/gen/`. Edit `server/proto/repairs/v1/submissions.proto` and regenerate.
11. When writing audit records, identify the real agent identity accurately. Do not use placeholder or misleading `sourceType` values.

## Where Things Live

- `AGENTS-README-FIRST.yaml` - local MCP marker and workspace contract, git-ignored.
- `CLAUDE.md` - Claude Code guidance that was used as source context for this workspace file.
- `README.md` - product overview, quick start, data format, repo layout, privacy notes.
- `docs/index.html` - the entire offline-first PWA: HTML, CSS, and JavaScript in one file.
- `docs/marketplace.json` - bundled offline seed catalog. The live catalog is in `sharpninja/repairs-data` on branch `approved`.
- `docs/sw.js` - service worker and offline shell cache.
- `server/` - optional Node ES module submit service, Connect/gRPC endpoints, GitHub PR integration, Claude moderation, Docker setup.
- `server/proto/repairs/v1/submissions.proto` - protobuf source.
- `server/gen/` - generated protobuf code, git-ignored.
- `tests/` - Node unit tests plus headless client/server integration tests.
- `guide/` - standalone CR-V guide slideshow and printable PDF assets.
- `scripts/init-data-repo.ps1` - bootstraps the `sharpninja/repairs-data` repository and `approved` branch from the seed catalog.

## Project Shape

This repository is an offline-first, phone-first PWA for DIY vehicle repair plus an optional backend that turns app submissions into GitHub pull requests.

The app has no bundler and no build step. `docs/index.html` contains the application shell, styles, and JavaScript. `docs/manifest.webmanifest`, `docs/sw.js`, icons, and `docs/marketplace.json` support installability, offline use, and first-load catalog data.

The code/data split matters:

- `sharpninja/repairs` is this repo: app, backend, tests, scripts, and bundled seed catalog.
- `sharpninja/repairs-data` is the published catalog. The app reads `marketplace.json` from its `approved` branch. Community submissions open PRs against that branch. Merging a PR publishes to the live catalog without redeploying this app.

## Common Commands

Run the static app locally from a secure-context origin:

```powershell
Set-Location docs
python -m http.server 8099
```

Then open `http://localhost:8099/`. `file://` is not enough for camera, microphone, service worker, or install behavior.

Run all tests:

```powershell
pwsh.exe -NoProfile -NonInteractive -File ./tests/run.ps1
```

Run individual test suites:

```powershell
node tests/store.test.mjs
node tests/integration.test.mjs
```

The integration test uses Playwright and Chromium. It serves `docs/` on a random port and mocks Anthropic, Google, GitHub, marketplace, and submit-backend calls. If Playwright is installed globally, set `NODE_PATH` as needed.

Backend service commands:

```powershell
Set-Location server
npm run generate
npm start
npm run monitor
npm run bans
docker compose up --build
./setup.ps1
```

`npm run generate` uses `buf generate` with remote plugins and needs network access. `docker compose up --build` runs the submit service, moderation monitor, and ngrok tunnel from `server/docker-compose.yml`.

Bootstrap the data repo when needed:

```powershell
pwsh.exe -NoProfile -NonInteractive -File ./scripts/init-data-repo.ps1 -Owner sharpninja -Repo repairs-data -Seed docs/marketplace.json
```

This requires GitHub CLI authentication and access to the data repo.

## App Architecture

`docs/index.html` is organized into labeled JavaScript sections. Search for `================= NAME =================` before adding behavior. Keep changes local to the relevant section and follow the existing terse style.

Preserve safe-by-construction rendering. Generated and imported guides must flow through typed blocks such as `steps`, `check`, `danger`, `crit`, `tip`, `spec`, and `note`. Untrusted guide data must never become raw HTML. The trust boundary is `createGuide`: it strips `html` fields and sanitizes phase colors. Preserve escaping through `esc`, hex color validation through `hexc`, and the CSP in `docs/index.html`.

Do not add new network destinations casually. The offline core should stay local-first. Current expected external destinations are the user-keyed Anthropic browser calls, Google identity APIs, `raw.githubusercontent.com` for the live catalog, and the optional submit backend such as `https://sharpninja.ngrok.app`. Update the CSP `connect-src` when backend origins change.

Storage is browser-local. Progress, guides, inventory, vehicles/VIN, reviews, session, and settings live in `localStorage`; captured media lives in IndexedDB (`crv-media`). Tools are tracked globally by stable ids; parts are tracked per guide.

When changing precached shell files, bump the service worker cache name in `docs/sw.js` or deployed clients may keep stale assets.

## Backend Architecture

The backend is a small Node ES module Connect/gRPC/gRPC-Web service. Browser users sign in with Google, the service verifies the Google ID token, mints a rotating session key, and uses that key for submissions. Submissions edit `marketplace.json` on a branch of `sharpninja/repairs-data` and open PRs against `approved`.

Key files:

- `server/src/server.js` - HTTP/CORS/health, Connect adapter, port binding.
- `server/src/routes.js` and `server/src/impl.js` - RPC routing and implementation.
- `server/src/github.js` - GitHub App or token auth, branch/edit/PR workflow, labels, moderation trigger.
- `server/src/moderate.js` - Claude Code CLI moderation using `CLAUDE_CODE_OAUTH_TOKEN`; treat PR content as untrusted data.
- `server/src/store.js` and `server/src/session.js` - file-backed trust, rate limiting, bans, and session storage.
- `server/src/monitor.js` - backstop moderation poller for open submission PRs lacking `ai:*` labels.

The file-backed stores are not concurrency-safe across replicas. Run one submit instance or replace storage with a real KV before scaling.

## Verification

Match validation to the change:

- Static app behavior: run or manually smoke the app from `docs/` on localhost; use browser validation for UI/camera/service-worker changes when practical.
- App shell/service-worker/catalog changes: run `pwsh.exe -NoProfile -NonInteractive -File ./tests/run.ps1` when Playwright is available.
- Backend logic: run `node tests/store.test.mjs` for store/session behavior and `node tests/integration.test.mjs` for browser-to-service flows.
- Protobuf/API shape changes: regenerate with `npm run generate`, then run the affected tests.
- Docker/deploy changes: validate `docker compose up --build` or the narrowest equivalent smoke test that exercises the edited path.

If a required verification step cannot run because a dependency, browser, network, or MCP surface is unavailable, state that clearly with the command attempted and the failure mode.
