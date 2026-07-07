# AI Auto Repairman — Design System

The visual language of a phone-first, offline-first repair companion. Everything here is the **source of truth as it exists in `docs/index.html`** (single-file PWA, inline tokens, no build step). Change a value there and this document describes what it should become.

A rendered, interactive version (live swatches + components, light/dark toggle) is published as an Artifact; this file is the version-controlled companion.

---

## Principles

1. **Warm, not clinical.** A warm off-white ground with a single terracotta accent — closer to a well-thumbed shop manual than a dashboard. One accent does all the pointing; everything else stays quiet.
2. **Phone-first & thumb-reachable.** Every size is fluid (`clamp()`) so type and padding scale with the viewport. Primary actions sit at the bottom of sheets or float within thumb reach; tap targets are 44px and up.
3. **Safe by construction.** Generated and imported content renders only through typed blocks (`steps`, `check`, `danger`, `crit`, `tip`, `spec`, `note`). No model- or import-supplied string is ever injected as HTML.
4. **Consistency over creativity.** Reach for a token, never a raw hex or arbitrary size. If it isn't a token, it shouldn't be in a component.

---

## Design tokens

All tokens are CSS custom properties defined on `:root` in `docs/index.html`. Dark values apply via `:root[data-theme="dark"]` (forced) or `@media (prefers-color-scheme: dark)` unless the user forced light.

### Color

**Surfaces & text**

| Token | Role | Light | Dark |
|-------|------|-------|------|
| `--bg` | App ground | `#faf9f5` | `#262624` |
| `--card` | Raised surface | `#ffffff` | `#30302e` |
| `--card2` | Recessed / fill | `#f1efe8` | `#3a3a36` |
| `--ink` | Primary text | `#20201e` | `#f4f3ee` |
| `--muted` | Secondary text | `#75736c` | `#a6a49a` |
| `--line` | Hairline / border | `#e7e4da` | `#403f3a` |

**Brand accent** — the only brand hue; reserved for primary actions, active state, and progress.

| Token | Role | Light | Dark |
|-------|------|-------|------|
| `--accent` | Terracotta | `#d97757` | `#e08a68` |
| `--accent-ink` | Text on accent | `#ffffff` | `#241812` |
| `--accent-soft` | Accent tint / rails | `#f6e7e0` | `#3a2a22` |

**Semantic families** — separate from the accent; they never borrow it, so severity reads pre-attentively. Each ships `base` (border/icon), `-bg` (fill), and `-ink` (text).

| Family | Meaning | base (L / D) | bg (L / D) | ink (L / D) |
|--------|---------|--------------|------------|-------------|
| `--tip` | Safe / confirm | `#2e7d55` / `#5cc78d` | `#e3f3ea` / `#123324` | `#1b4d34` / `#c6f0da` |
| `--crit` | Caution / spec | `#a76a16` / `#e0a63f` | `#fbf0da` / `#392f18` | `#734810` / `#ffe8c2` |
| `--danger` | Danger / destructive | `#b23b2e` / `#e5645a` | `#fbe9e6` / `#38201c` | `#7e241b` / `#ffd7d1` |

> Neutrals carry a faint warm bias on purpose — a pure mid-grey would read as unconsidered against the cream ground.

### Typography

Three roles. All are **system font stacks** (no webfont load, no CDN, native feel, graceful degradation).

| Role | Token | Stack | Use for |
|------|-------|-------|---------|
| Display | `--serif` | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif` | Product name, sheet & section titles |
| Body | `--sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | Guides, controls, chat |
| Data | *(mono, inline)* | `ui-monospace, Menlo, Consolas, monospace` | VIN, torque/specs, code |

**Fluid scale** — every step is a `clamp(min, vw, max)`:

| Token | Range | Applied to |
|-------|-------|-----------|
| `--h1` | `clamp(26px, 7.5vw, 44px)` | Product name / hero heading |
| `--h2` | `clamp(21px, 6vw, 34px)` | Section titles |
| `--big` | `clamp(19px, 5vw, 26px)` | Step titles, emphasis |
| `--body` | `clamp(17px, 4.4vw, 22px)` | Running text, callouts |
| label | `~.76em`, `800`, `uppercase`, `letter-spacing:.04–.05em` | Callout labels, eyebrows |

### Space, form & motion

| Token / value | Purpose |
|---------------|---------|
| `--pad: clamp(16px, 4.5vw, 32px)` | Gutter and section padding |
| gaps `6 · 8 · 10 · 14px` | Inline flex/grid `gap` (never per-element margins) |
| `--shadow` | Two-layer warm elevation: `0 1px 2px rgba(20,19,17,.05), 0 6px 20px rgba(20,19,17,.05)` (dark: heavier, black) |

**Radius ladder**

| Radius | Applied to |
|--------|-----------|
| `999px` | Pills, progress track, FABs, badges |
| `20px` | Sheet top corners |
| `14px` | Cards, callouts, inputs |
| `13px` | Buttons |
| `10–12px` | Chips, aux buttons, thumbnails |

**Motion** — confined to state changes; `prefers-reduced-motion` is honored.

| Motion | Value |
|--------|-------|
| Progress fill | `width .3s` |
| Sheet enter | slide-up `.22s ease` |
| Press feedback | `translateY(1px)` / `scale(.94–.97)` |

---

## Components

### Button

Reusable action element. Base class `.btn`; grouped with `.btnrow` (flex, `gap:10px`).

| Variant | Class | Use when |
|---------|-------|----------|
| Primary | `.btn.pri` | The one committing action in a view (Save, Submit, Install) |
| Default | `.btn` | Secondary / neutral actions (Cancel, Guides, New Repair) |
| Destructive | `.btn.dgr` | Irreversible actions (Reset, Delete); pair with a confirm sheet |
| Pill | `.pill2` | Rounded toggles / filters / chips-as-buttons |
| Icon | `.cataux` | 44×48 capture affordances (camera, gallery) beside an input |
| Floating | `#fabs button` | Persistent Ask-Claude ✦ and voice 🎙️, 54px, bottom-right |

| State | Treatment |
|-------|-----------|
| Default | Card fill + hairline + soft shadow; primary swaps to accent |
| Active (press) | `translateY(1px)` (btn) / `scale(.94)` (FAB) |
| Disabled | `opacity:.4`, non-interactive (e.g. Submit until valid) |
| Focus | 2px accent outline, 2px offset (keyboard-visible) |

**Accessibility** — native `<button>`; Enter/Space activate; disabled removes from tab order. One primary action per view.

### Callout

One component, three semantic skins. Class `.call` + `.tip` / `.crit` / `.danger`, with `.ic` (icon) and `.t` (uppercase label).

| Variant | Family | Use when |
|---------|--------|----------|
| `.call.tip` | tip (green) | Helpful advice, confirmation |
| `.call.crit` | crit (amber) | Specs to verify, caution |
| `.call.danger` | danger (red) | Hazards, must-not-skip warnings |

Colors come **only** from the semantic families — never the accent — so severity reads at a glance. These are the render targets for the guide's typed `danger` / `crit` / `tip` / `spec` / `note` blocks.

### Card — vehicle

Selectable garage tile. Class `.vcard`.

| Variant | Signal |
|---------|--------|
| `.vcard.on` | Selected — accent border + 1px inset ring; drives the guide filter |
| `.vcard` | Selectable vehicle |
| `.vcard.add` | Muted, centered "add another" affordance |

Contains a bold label + a `.vinmono` (monospace VIN, muted). Marketplace guide cards follow the same card grammar (surface + hairline + `--shadow`).

### Sheet — the one modal primitive

Every dialog (settings, vehicles, policies, chat, confirms) is one bottom sheet. `.sheet` (dimmed scrim) > `.panel` (`.head` + `.body`).

| Property | Value |
|----------|-------|
| Anchor | Bottom, slides up `.22s` |
| Width | `100%`, `max-width:860px` |
| Height | `max-height:92dvh`; **chat variant fills from the toolbar down** |
| Structure | Header (title + ✕) · scrollable body · primary action last |
| Dismiss | ✕ button, tap-scrim, `Esc` |

### Chat — messages & photo attach

| Part | Class | Behavior |
|------|-------|----------|
| Assistant message | `.msg.a` | Recessed fill, left-aligned, bottom-left tail |
| User message | `.msg.u` | Accent fill, right-aligned, bottom-right tail |
| In-message photo | `.msg img` | Fills the bubble up to **460px** so parts are legible |
| Attach preview | `.attachchip` | Pre-send **104px** thumbnail with an overlaid circular remove control |
| Composer | `.chatinput` | Camera + gallery (`.cataux`) + auto-growing `<textarea>` + `.send`; lives in the sheet foot |

### Status & media

| Element | Class | Note |
|---------|-------|------|
| Progress strip | `#topbar > i` | Accent fill on a `--line` track; mirrors the `%` in the top bar |
| Video facade | `.ytfacade` / `.ytplay` | Click-to-load poster; the `youtube-nocookie` iframe is inserted only on tap (no third-party load until asked) |
| Record badge | `.badge` | Fixed capture indicator during camera/voice recording |

### Chrome

| Element | Role |
|---------|------|
| `#top` | Sticky top bar: menu, product title, theme, completion `%` |
| `#topbar` | 4px progress track under the top bar |
| `#vehbar` | Sticky vehicle-context `<select>` (home only, when a vehicle exists) |
| `#fabs` | Floating Ask-Claude + voice buttons, bottom-right |

The three sticky rows are wrapped in a single `#topwrap` container so there is no two-sticky overlap.

---

## Do & don't

| ✅ Do | 🚫 Don't |
|------|---------|
| Let terracotta mean "the action here." One primary per view. | Tint semantic callouts with the accent — severity stops reading. |
| Use `tip` / `crit` / `danger` for meaning; reach for tokens. | Hardcode sizes — every step is a `clamp()` on the scale. |
| Route every dialog through the sheet primitive; primary action last. | Inject model- or import-supplied strings as HTML. Typed blocks only. |
| Keep tap targets ≥ 44px; put primary actions in thumb reach. | Introduce a second brand hue or a new radius outside the ladder. |

---

## Accessibility notes

- **Color** — semantic meaning is always carried by an icon + label in addition to hue, not hue alone.
- **Focus** — interactive elements show a 2px accent outline on keyboard focus.
- **Motion** — `@media (prefers-reduced-motion: reduce)` disables transitions.
- **Theming** — respects the OS `prefers-color-scheme`; a manual light/dark override is available and persisted.
- **Targets** — controls are ≥ 44px; the composer's textarea grows rather than truncating.

---

## Versioning

- Tokens and components live in `docs/index.html`; the service-worker shell is versioned (currently `crv-s1-v15`) and **must be bumped whenever precached shell files change**, or old clients serve a stale shell.
- Breaking a token (renaming/removing) is an app-wide change — grep `docs/index.html` for every use first.
