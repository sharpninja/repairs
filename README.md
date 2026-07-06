# Repairs — an offline, AI-assisted DIY vehicle-repair app

A phone-first **Progressive Web App** for doing your own car repairs in the driveway.
It's **installable**, works **fully offline**, tracks your progress, lets you **log
photos / voice / video** as you work, links every **tool and part** to Amazon, and has
an in-app **Claude** helper with vision. It ships with a complete built-in guide for a
**2018 Honda CR-V 1.5T**, and can **generate a brand-new guide for any vehicle + job**
on demand.

- **App:** [`docs/`](docs/) — self-contained, no build step, no dependencies.
- **Live (once Pages is on):** `https://sharpninja.github.io/repairs/`

---

## Highlights

- **Follow a guide** — phase by phase, one action per step, big text for a phone,
  inline SVG diagrams, and layered safety callouts (🛑 danger / ⚠️ critical / 💡 tip).
- **New Repair — Claude-generated guides** — tap **＋ New Repair**, describe any vehicle
  and job, and Claude drafts a full, safety-first guide in the app's format that becomes
  instantly followable. The sheet ships an editable **boilerplate prompt** and shows the
  **data format** it fills in. See [New Repair — data format](#new-repair--data-format).
- **Merge guides with AI** — in **⇄ Guides → ⤵ Merge**, pick two or more guides and Claude
  combines them into one: shared teardown/drain steps are done **once**, the work is
  re-sequenced (shared prep → each job → one final verification), and tools & parts are
  unioned and de-duplicated. The originals are kept; a new merged guide is added. Perfect
  for jobs done together on one coolant drain / front-end teardown.
- **Guide library** — switch guides with **⇄ Guides**, **⬇ Add guide** (paste/import a
  guide's JSON), or **⧉ Share/export** one (copy JSON or download `.json`) to move guides
  between devices or people. The built-in CR-V guide lives alongside your own. Each guide
  carries **environment tags** — 🏭 Shop / 🔧 Garage / 🏠 Driveway / 🛣️ Roadside — and a
  **region** (🇺🇸 US / 🇨🇦 CA / 🇬🇧 UK / 🇪🇺 EU / 🇦🇺 AU / 🇲🇽 MX / 🇮🇳 IN / 🇯🇵 JP),
  shown as chips on the dashboard and in the switcher. The region also **picks the Amazon
  marketplace** for that guide's Tools & Parts links (e.g. a UK guide links to
  `amazon.co.uk`), so parts land in the right store.
- **Marketplace + discovery by vehicle** — **🛒 Marketplace** browses a curated catalog
  ([`docs/marketplace.json`](docs/marketplace.json)). Guides carry **fitment metadata**
  (makes / models / year range, or *universal*), so with an active vehicle a **"For your
  2018 Honda CR-V"** section surfaces the guides that match — install any with one tap.
  The catalog is cached for **offline** browsing.
- **Ratings & AI-moderated reviews** — rate a guide with **stars** and write a review;
  **Claude moderates** it (rejecting abuse, spam, personal data, or unsafe advice, and
  lightly cleaning the rest) before it's saved. Ratings shown combine the community seed
  with your own, stored **on-device**.
- **Submit to the catalog by PR (optional)** — with the [submit service](server/) running,
  sign in with **Google** and use **🚀 Submit as PR** (on a review) or **🚀 Submit to
  marketplace** (on a guide, via *Guides → Share/export*) to open a **GitHub pull request**
  adding your rating/review or full repair to the shared catalog. Reviews are AI-moderated
  first; a maintainer merges. Without the service configured, everything stays on-device
  (a **⧉ Contribute** action still copies your JSON and opens a prefilled issue).
- **Vehicles by VIN** — save your cars by **VIN** in **🚗 My vehicles**. Read the VIN three
  ways: **scan the barcode** on the driver's door-jamb sticker (offline, via the browser's
  `BarcodeDetector`), **📷 read a stamped VIN** (dashboard plate or sticker) with Claude
  vision, or just **type it**. The VIN is validated (17-char charset + ISO-3779 check
  digit) and decoded on-device for **model year** and region. The active vehicle's VIN is
  handed to the Claude helper and New Repair so every *"verify against your VIN"* fitment
  answer is about *your* exact car. Stored on-device only.
- **Completion tracking** — overall % ring + per-phase progress bars, resume, and reset.
  Per-guide, saved on-device (localStorage).
- **Contemporaneous logging** — on most steps, capture a **📷 photo**, **🎙️ voice note**,
  or **🎬 video clip** as you work (MediaRecorder). Everything is timestamped, stored
  on-device (IndexedDB), and collected chronologically in the **Session Log**.
- **Tools & Parts** — a categorized shopping list with **Amazon search links** for every
  tool and part, plus a verify-fitment-by-VIN caveat. Tap **＋ I have it** to mark what you
  own: **tools are tracked across every guide/session** (you own a torque wrench no matter
  the job), while **parts are tracked per guide** (they're job-specific). A running
  "Have X of Y" tally sits at the top of each list. Tools are drawn from a **standardized
  tool library** with stable ids, so the same tool is recognized as *owned* across guides
  even when a generated guide words its name a little differently — and New Repair is told
  to reuse those library ids.
- **Claude helper (vision)** — the *Ask Claude* button opens a chat primed with the
  active guide. Attach a captured photo (or grab a frame from a video clip) and ask
  *"does this O-ring look seated right?"* — with vision. Pick your **model** in ⚙️
  (**Sonnet 5** by default, or Opus 4.8 / Haiku 4.5 to trade quality against cost); the
  choice applies to Ask Claude, hands-free voice, and New Repair. Requires **your own
  Anthropic API key** (entered once via ⚙️, stored only in-browser).
- **Hands-free voice** — tap the **🎙️** button and work with dirty hands: say your
  **wake word** (default *"Hey Claude"*, editable) then either a **voice command** or a
  question out loud. Commands navigate and narrate without touching the screen —
  *"next step"*, *"previous step"*, *"go to step 5"*, *"read step"* (reads it aloud),
  *"reword step"* (Claude rephrases it simpler), *"I need help"* (Claude troubleshoots the
  step), *"repeat"*, *"go home"*, and *"end chat"* to drop back to the step. Anything else
  is answered by Claude out loud, then it listens for a follow-up. Uses the browser's Web
  Speech API (recognition + synthesis) and a **screen wake lock** so the display stays on
  while you work. All voice control is on-device; only questions themselves reach Claude.
- **Themes** — System / Light / Dark, toggled from the header, following
  `prefers-color-scheme` by default. Styled to match the Claude ecosystem (coral accent,
  warm-paper light / charcoal dark, serif display). Honda-H app icon + favicon.
- **Offline-first** — the whole guide, progress, camera/mic capture, stored media, voice
  recognition/synthesis, and **VIN barcode scanning** work with **no internet**. Only the
  Claude features (*Ask Claude*, hands-free voice questions, *New Repair*, and *📷 read VIN*)
  reach `api.anthropic.com`.
- **Safe by construction** — generated *and imported* guides render through a typed-block
  renderer: the model/JSON never yields raw HTML (any `html` field is ignored, phase
  colors are sanitized to hex, all text is escaped).

---

## Quick start

**Run locally** — `localhost` is a secure context, so camera, mic, install, and the
service worker all work:

```bash
cd docs
python3 -m http.server 8099
# open http://localhost:8099/
```

`file://` will **not** enable the camera, mic, install, or service worker — use
`localhost` or HTTPS.

**Install from GitHub Pages (branch deploy):**

1. **Settings → Pages → Build and deployment → Source: *Deploy from a branch*.**
2. **Branch:** `main`, **Folder:** `/docs` → **Save**.
3. Open `https://sharpninja.github.io/repairs/` on your phone → browser menu →
   **Add to Home Screen**.

Pages serves over HTTPS, so camera, mic, install, and offline all work. All app paths are
relative, so it runs correctly under the `/<repo>/` subpath.

---

## Repo layout

| Path | What it is |
|------|-----------|
| [`docs/index.html`](docs/index.html) | **The entire app** — self-contained HTML/CSS/JS. Home dashboard, step flow, Tools & Parts, Session Log, New Repair, Guides. |
| [`docs/marketplace.json`](docs/marketplace.json) | **Curated guide catalog** — the marketplace's guides + fitment metadata and seed ratings/reviews. Cached for offline. |
| `docs/manifest.webmanifest` · `docs/sw.js` · `docs/icon-*.png` · [`docs/favicon.svg`](docs/favicon.svg) | PWA manifest, offline service worker, Honda-H icons and favicon. |
| [`guide/`](guide/) | The built-in CR-V guide as a standalone **slideshow + printable PDF** (see [below](#also-available-as-a-slideshow--pdf)). |
| [`server/`](server/) | **Optional** Dockerized **gRPC / Connect** submit service — turns Google-authenticated app submissions into GitHub PRs against the catalog. The app works fully without it. |

The **app** itself is one static folder — nothing to build or install. The **submit
service** is optional; deploy it only if you want in-app PR submission (see
[`server/README.md`](server/README.md)).

### Contributing guides & reviews via PR

The app can open pull requests against [`docs/marketplace.json`](docs/marketplace.json)
for you, using the optional [`server/`](server/) service:

1. **Deploy the service** (Docker) and give it a **Google OAuth client ID** and a
   **GitHub credential** (bot PAT or GitHub App) — see [`server/README.md`](server/README.md).
2. In the app, **⚙️ → Community submissions**, set the **Backend URL** and the same
   **Google client ID**.
3. Sign in with Google and hit **🚀 Submit** — the service verifies your Google identity,
   commits to a branch, and opens a PR crediting you. A maintainer reviews and merges.

Because GitHub write access can't come from a Google login alone (and browsers can't call
GitHub's token endpoints directly), this one feature needs a tiny backend — everything else
in the app is backend-free.

---

## New Repair — data format

The New Repair sheet sends your prompt to your selected model with a system prompt that
constrains the reply to a **single JSON object**. The app validates it, then renders each
step from **typed content blocks** (never raw HTML from the model). Shape:

```jsonc
{
  "title": "2015 Subaru Outback 2.5i — Front Brakes",
  "subtitle": "Front pads + rotors",
  "safety": "Chock the wheels and use jack stands — never rely on the jack alone.",
  "region": "us",                         // us, ca, uk, eu, au, mx, in, jp → picks the Amazon store
  "env": ["driveway", "garage"],          // any of: shop, garage, driveway, roadside
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
  "tools": [ { "id": "torque-wrench-half", "d": "Caliper & lug torque" },   // library id → tracked as owned across guides
             { "n": "Brake caliper piston tool", "q": "amazon terms" } ],   // no id → one-off tool
  "parts": [ { "g": "Brakes", "items": [ { "n": "Front brake pads", "d": "Match your trim", "q": "…" } ] } ]
}
```

Block types: `steps` (numbered), `check` (checklist — counts toward progress),
`danger`/`crit`/`tip` (🛑/⚠️/💡 callouts), `spec` (torque/fluid value + a "verify against
the FSM" note), `note` (paragraph). `**double asterisks**` render as bold. The system
prompt tells Claude to lead with safety, keep one action per step, and flag any spec that
must be verified against the factory service manual rather than presenting an invented
number as certain. It also passes the **standardized tool library** and asks Claude to
reference tools by their `id` (so they track as *owned* across guides), and to set `env`
to where the job is realistically done and `region` to the user's market (which also
selects the Amazon marketplace for the links). On import, tools that carry a known library `id`
are canonicalized to the library's name/search terms; unknown-`id` or id-less tools are
kept as one-offs. The same format is what **⬇ Add guide** imports.

---

## Built-in guide: 2018 Honda CR-V 1.5T (Session 1)

The app ships with a complete "Session 1" guide for a **2018 Honda CR-V 1.5L Turbo
(L15B7)** — three jobs done together because they share a coolant drain and front-end
teardown:

1. **A/C compressor + condenser** — refrigerant recovered beforehand; the system is left
   **open/empty** at the end and the car is driven to a shop for evacuate-and-recharge.
2. **Engine Coolant Temperature Sensor 2 (ECT2)** — lower radiator tank.
3. **Bar's Leaks HG-1** head-gasket stop-leak (½ bottle, cold engine).

**Phases:** `0` prep & safety → `1` lift & drain → `2` front bumper → `3` A/C (cap lines,
drain & measure oil, hand-rotate the new compressor, new oiled O-rings, torque) → `4`
ECT2 (new O-ring, don't overtighten the plastic tank) → `5` reassemble → `6` refill +
½-bottle HG-1 cold, self-bleed, idle until the fan cycles twice → `7` verify, leak-check,
**A/C stays OFF**, drive to the shop.

**The 5 recurring warnings:** (1) never open A/C lines under pressure; (2) cap every open
line **instantly**; (3) fresh **oiled** O-ring at every fitting; (4) hand-rotate the new
compressor 8–10 turns; (5) HG-1 goes in **cold**, ½ bottle.

### ⚠️ Verify against the factory manual / your VIN

Flagged inline in the app; not fully settled from public sources — confirm before buying
tools or adding fluids:

- **ECT2 socket** — reports split **17 mm vs 19 mm**; measure the flats. Threads into a
  **plastic** tank — snug + a nudge, no torque spec.
- **A/C oil (refrigerant confirmed R-1234yf)** — **not** generic R-134a PAG46. Honda
  R-1234yf systems use their own oil (**ND-OIL 12 / POE**). Confirm the part number for
  your VIN; let the shop set the final oil charge (bring your measured old-oil number).
- **A/C torque** — *typical Honda* figures in the guide (line flanges ≈9.8–12 N·m;
  compressor mounts ≈24–25 N·m / 18 lb-ft; condenser fittings ≈9.8 N·m). Verify against
  the 2017–2022 CR-V service manual.
- **Coolant** — Honda Type 2 (blue), 50/50. **No bleed bolt** — self-bleeds via the
  pressurized expansion/degas tank.

*Nothing here replaces the factory service manual — always cross-check torque and fluid
specs for your exact VIN.*

### Also available as a slideshow + PDF

| File | What it is |
|------|-----------|
| [`guide/crv-session1.html`](guide/crv-session1.html) | **Phone slideshow** — one step per screen, tap/swipe or arrow keys, big text, persistent checkboxes, inline SVG diagrams. Self-contained. |
| [`guide/crv-session1.pdf`](guide/crv-session1.pdf) | **Printable PDF** — one major step per page, checkboxes to pen off. |
| [`guide/render-pdf.js`](guide/render-pdf.js) | Playwright script that regenerates the PDF from the HTML. |

Regenerate the PDF:

```bash
cd guide
NODE_PATH=$(npm root -g) node render-pdf.js crv-session1.html crv-session1.pdf
```

Requires Node + a Playwright-managed Chromium (the script points at
`/opt/pw-browsers/chromium`; adjust `executablePath`, or `npx playwright install chromium`).

---

## Privacy

Progress and all media (photos, voice, video) stay **on your device** (localStorage +
IndexedDB) — nothing is uploaded. The only network calls are the two Claude features,
which go directly from your browser to `api.anthropic.com` using **your own** API key
(stored only in your browser, via the `anthropic-dangerous-direct-browser-access` header).
No secrets are in this repo.
