# 2018 Honda CR-V 1.5T (L15B7) — DIY Repair Guide, Session 1 of 2

A phone-friendly, one-step-per-screen repair guide for a driveway DIY session on a
**2018 Honda CR-V 1.5L Turbo (L15B7 engine)**. Session 1 combines three jobs that
share a coolant drain and front-end teardown:

1. **A/C compressor + condenser replacement** — refrigerant was professionally
   recovered beforehand; the system is left **open/empty** at the end and the car is
   driven to a shop for evacuate-and-recharge.
2. **Engine Coolant Temperature Sensor 2 (ECT2) replacement** — lower radiator tank.
3. **Bar's Leaks HG-1** head-gasket stop-leak treatment (½ bottle, cold engine).

## Files

### The app (recommended)

An installable, **fully offline** Progressive Web App with completion tracking, a
per-step camera, and an in-app Claude helper.

| File | What it is |
|------|-----------|
| [`app/index.html`](app/index.html) | The app. Home dashboard with an overall progress ring + per-phase bars; step-by-step flow with big text, diagrams, and warnings; tappable checkboxes and progress saved on-device (localStorage). |
| [`app/manifest.webmanifest`](app/manifest.webmanifest) · [`app/sw.js`](app/sw.js) · `app/icon-*.png` | PWA manifest, offline service worker, and icons — make it installable to a phone home screen and runnable with no network. |

**App features**
- **Completion tracking** — overall % ring, per-phase progress, resume where you left off, reset. Saved on the device.
- **Camera** — on most steps, tap *Add a photo* to document the work (measured oil, a torqued fitting, a seated O-ring). Photos are stored on-device in IndexedDB, shown as thumbnails.
- **Claude helper** — the *Ask Claude* button opens a chat that knows this exact job (including the R-1234yf/oil and ECT2-socket caveats). Attach a captured photo and ask *"does this O-ring look seated right?"* — it uses Claude's vision. Requires **your own Anthropic API key** (entered once via the ⚙️ button, stored only in your browser).
- **Offline** — everything except the Claude helper works with no internet: the whole guide, progress, camera, and stored photos. Only the Claude call reaches `api.anthropic.com`.

**Running it** — the app must be served over **HTTPS or `localhost`** (camera, install, and the service worker all require a secure context — opening the file with `file://` won't enable them). Quickest local run:

```bash
cd app
python3 -m http.server 8099
# then open http://localhost:8099/  on the same machine
```

For phone use, host `app/` on any static HTTPS host (GitHub Pages, Netlify, etc.) and open it on the phone, then "Add to Home Screen".

### Printable / slideshow guide

| File | What it is |
|------|-----------|
| [`guide/crv-session1.html`](guide/crv-session1.html) | **Phone slideshow** — one step per screen, tap/swipe or arrow keys, big text, persistent checkboxes, inline SVG diagrams. Fully self-contained. |
| [`guide/crv-session1.pdf`](guide/crv-session1.pdf) | **Printable PDF** — one major step per page, checkboxes to pen off. |
| [`guide/render-pdf.js`](guide/render-pdf.js) | Playwright script that regenerates the PDF from the HTML. |

## Regenerate the PDF

```bash
cd guide
NODE_PATH=$(npm root -g) node render-pdf.js crv-session1.html crv-session1.pdf
```

Requires Node + a Playwright-managed Chromium. The script points at
`/opt/pw-browsers/chromium`; adjust `executablePath` for your machine, or install
with `npx playwright install chromium`.

## The 5 recurring warnings (emphasized throughout)

1. Never open A/C lines under pressure.
2. Cap every open line **instantly** — moisture ruins the new parts and the recharge.
3. Fresh, **oiled** O-ring at every A/C fitting (a missed O-ring is the #1 leak).
4. Hand-rotate the new compressor 8–10 turns before it ever runs.
5. HG-1 goes in a **cold** engine only, ½-bottle dose (system holds ~6.2 L ≈ 6.5 qt).

## Phases

- **Phase 0** — Cold engine; confirm 0 psi; battery (−) off; stage parts + two drain pans.
- **Phase 1** — Jack stands, splash shield off, drain coolant at the radiator petcock.
- **Phase 2** — Remove front bumper cover fasteners for condenser clearance.
- **Phase 3** — A/C: unplug clutch → unbolt & **cap lines** → 4 compressor bolts →
  **drain & measure** old oil → remove condenser → prep new compressor (set oil,
  PAG in suction, **hand-rotate 8–10 turns**) → ~1 oz oil to condenser → install with
  **new oiled O-rings** → torque.
- **Phase 4** — ECT2: unplug, unscrew, new O-ring, **don't overtighten the plastic tank**.
- **Phase 5** — Reassemble bumper (new clips), splash shield, reconnect battery.
- **Phase 6** — Refill 50/50 coolant + ½ bottle HG-1 cold, self-bleed via degas tank,
  idle ~15 min with heater HIGH until the fan cycles twice, top off.
- **Phase 7** — Verify O-rings/torque, leak-check, **A/C stays OFF**, drive to shop.

## ⚠️ Specs you must verify against the factory manual / your VIN

The guide flags these inline. They are **not fully settled from public sources** —
confirm before you buy tools or add fluids:

- **ECT2 socket size** — reports split between **17 mm and 19 mm**. Measure the flats
  or bring both. It threads into a **plastic** tank — snug + a nudge, no torque spec.
- **A/C oil (refrigerant confirmed R-1234yf)** — do **not** use generic R-134a PAG46.
  Honda R-1234yf A/C systems use their own oil (**ND-OIL 12 / POE** per Honda service
  info). Confirm the exact oil part number for your VIN, and let the shop set the final
  oil charge with the recharge (bring your measured old-oil number).
- **A/C torque values** in the guide are *typical Honda* figures (line flanges
  ≈9.8–12 N·m; compressor mounts ≈24–25 N·m / 18 lb-ft; condenser fittings ≈9.8 N·m).
  Verify against the 2017–2022 CR-V service manual.
- **Coolant** — Honda Type 2 (blue), pre-mixed 50/50. **No bleed bolt** on this engine;
  it self-bleeds through the pressurized expansion/degas tank.

*This is Session 1 of a two-session plan. Nothing here replaces the factory service
manual — always cross-check torque and fluid specs for your exact VIN.*
