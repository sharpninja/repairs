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

### The app (recommended) — in [`docs/`](docs/)

An installable, **fully offline** Progressive Web App, styled to match the Claude
ecosystem (coral accent, warm-paper light theme / charcoal dark theme, serif display),
with completion tracking, contemporaneous media logging, a tools & parts list, and an
in-app Claude helper. Lives in `docs/` so it deploys straight from **GitHub Pages
(branch → `/docs`)**.

| File | What it is |
|------|-----------|
| [`docs/index.html`](docs/index.html) | The whole app (self-contained HTML/CSS/JS). Home dashboard with a progress ring + per-phase bars; step-by-step flow with diagrams and warnings; Tools & Parts and Session Log views. Progress saved on-device (localStorage). |
| [`docs/manifest.webmanifest`](docs/manifest.webmanifest) · [`docs/sw.js`](docs/sw.js) · `docs/icon-*.png` · [`docs/favicon.svg`](docs/favicon.svg) | PWA manifest, offline service worker, Honda-H icons and favicon. |

**App features**
- **New Repair (Claude-generated guides)** — tap **＋ New Repair** to describe any vehicle + job; Claude drafts a full phased, safety-first guide in the app's format and it becomes a followable guide instantly (progress, media, Tools & Parts, and the contextual helper all work for it). The **⇄ Guides** picker switches between the built-in CR-V guide and your generated ones, and lets you **⬇ Add guide** (paste/import a guide's JSON) or **⧉ Share/export** one (copy JSON or download `.json`) to move guides between devices or people. The New Repair sheet ships an editable **boilerplate prompt** and shows the **data format** Claude fills in. Generated *and imported* content renders through a safe typed-block renderer — the model/JSON never yields raw HTML (any `html` field is ignored, phase colors are sanitized to hex, all text is escaped). See [Data format](#new-repair-data-format) below.
- **Completion tracking** — overall % ring, per-phase progress, resume, reset. Per-guide, on-device.
- **Contemporaneous logging** — on most steps, capture a **📷 photo**, **🎙️ voice note**, or **🎬 video clip** as you work. Everything is timestamped and stored on-device (IndexedDB) and collected chronologically in the **Session Log**.
- **Tools & Parts** — a categorized shopping list with **Amazon search links** for every tool and part (with a "verify fitment by VIN" caveat, since the compressor/condenser/ECT2 are 1.5T-specific and the A/C oil must be the R-1234yf type).
- **Claude helper (vision)** — the *Ask Claude* button opens a chat primed with this exact job and its caveats. Attach a captured photo (or grab a frame from a video clip) and ask *"does this O-ring look seated right?"* — uses **claude-opus-4-8** with vision. Requires **your own Anthropic API key** (entered once via ⚙️, stored only in your browser).
- **Theme** — System / Light / Dark, toggled from the header, following `prefers-color-scheme` by default.
- **Offline** — everything except the Claude helper works with **no internet**: the whole guide, progress, camera/mic capture, and stored media. Only the Claude call reaches `api.anthropic.com`.

**Install from GitHub Pages (branch deploy)**
1. Merge this branch into your default branch (the app must be in `docs/` on that branch).
2. Repo **Settings → Pages → Build and deployment → Source: *Deploy from a branch***.
3. **Branch:** your default branch, **Folder:** `/docs` → **Save**.
4. Open `https://<user>.github.io/<repo>/` on your phone → browser menu → **Add to Home Screen**.

Pages is served over HTTPS, so camera, microphone, install, and the service worker all work. (All app paths are relative, so it runs correctly under the `/<repo>/` subpath.)

**Run it locally**

```bash
cd docs
python3 -m http.server 8099
# open http://localhost:8099/ (localhost is a secure context, so camera/mic/SW work)
```

`file://` won't enable the camera, mic, install, or service worker — use `localhost` or HTTPS.

<a id="new-repair-data-format"></a>
**New Repair — data format**

The New Repair sheet sends your prompt to `claude-opus-4-8` with a system prompt that
constrains the reply to a single JSON object. The app validates it, then renders each
step from **typed content blocks** (no raw HTML from the model). Shape:

```jsonc
{
  "title": "2015 Subaru Outback 2.5i — Front Brakes",
  "subtitle": "Front pads + rotors",
  "safety": "Chock the wheels and use jack stands — never rely on the jack alone.",
  "phases": [
    { "name": "Phase 1 · Lift & Wheels", "color": "#4a86c5",
      "steps": [
        { "t": "Loosen lugs, lift, remove wheel", "allowMedia": true,
          "body": [
            { "type": "steps",  "items": ["Crack the **lug nuts** 1/2 turn…", "…"] },
            { "type": "check",  "items": ["Lugs torqued to spec", "…"] },
            { "type": "danger", "title": "Stands, not the jack", "text": "A jack can drop…" },
            { "type": "crit",   "title": "…", "text": "…" },
            { "type": "tip",    "title": "…", "text": "…" },
            { "type": "spec",   "text": "Caliper bolts ~80 ft-lb", "verify": "Confirm vs the FSM for your VIN." },
            { "type": "note",   "text": "Plain paragraph." }
          ] } ] } ],
  "tools": [ { "n": "Torque wrench (ft-lb)", "d": "Caliper & lug torque", "q": "amazon search terms" } ],
  "parts": [ { "g": "Brakes", "items": [ { "n": "Front brake pads", "d": "Match your trim", "q": "…" } ] } ]
}
```

Block types: `steps` (numbered), `check` (checklist — counts toward progress), `danger`/`crit`/`tip`
(🛑/⚠️/💡 callouts), `spec` (torque/fluid value + a "verify against the FSM" note), `note`
(paragraph). `**double asterisks**` render as bold. The system prompt tells Claude to lead with
safety, keep one action per step, and flag any spec that must be verified against the factory
service manual rather than presenting an invented number as certain.

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
