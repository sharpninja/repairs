# Tests

Covers every client↔server interaction in the app plus the backend's stateful logic.

| File | What it checks | Deps |
|------|----------------|------|
| [`store.test.mjs`](store.test.mjs) | Backend **trust** scoring (approve/flag/reject/merged → block threshold) and **rate limiting** (1/min), and **session** create/rotate/resolve/expire. Runs `server/src/store.js` + `session.js` for real. | none (pure Node) |
| [`integration.test.mjs`](integration.test.mjs) | The app driven in a headless browser with every external endpoint mocked: **Anthropic** (Ask Claude, New Repair, Merge, VIN OCR, VIN decode), the **marketplace catalog** fetch, the **submit backend** (StartSession, RefreshSession, SubmitReview, SubmitRepair, GetSubmissionStatus), **Google** sign-in, and the **startup session negotiation + PR-live toast**. Asserts every submission is tagged with the session key. | Playwright + Chromium |

## Run

```bash
./tests/run.ps1
```

Or individually:

```bash
node tests/store.test.mjs
NODE_PATH=/opt/node22/lib/node_modules node tests/integration.test.mjs   # or `npm i -D playwright`
```

The integration test serves `docs/` on a random port and intercepts all network
calls, so it never touches the real Anthropic API, Google, or GitHub.
