# Design brief — AI Auto Repairman

A paste-ready guidance block for **claude.ai/design** (or any design agent). Create a project, paste everything under the rule below into its instructions, and attach [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) for depth. This is a distilled, agent-actionable form of the full system — real token names, the class idiom, and hard rules — so every screen it produces is on-brand and maps cleanly onto `docs/index.html`.

> This app is a single-file vanilla PWA with no compiled component library, so it can't be imported via `design-sync`. This brief is the manual equivalent: it teaches the design agent the tokens, idiom, and rules directly.

---

Phone-first, offline-first DIY vehicle-repair companion. Design for someone reading on a phone in a driveway: bright sun, greasy hands, one thumb. Warm and tactile — a well-thumbed shop manual, not a dashboard.

## Idiom

Vanilla HTML + CSS custom properties (design tokens) + a class vocabulary. System fonts only (no webfonts). Style via `var(--token)` and the classes below; never introduce a second brand hue or a radius outside the ladder.

## Tokens (light / dark)

- Ground `--bg` #faf9f5 / #262624 · Raised `--card` #ffffff / #30302e · Fill `--card2` #f1efe8 / #3a3a36
- Text `--ink` #20201e / #f4f3ee · Muted `--muted` #75736c / #a6a49a · Hairline `--line` #e7e4da / #403f3a
- Accent (the only brand hue — actions / active / progress) `--accent` #d97757 / #e08a68 · on-accent `--accent-ink` #ffffff / #241812 · tint `--accent-soft` #f6e7e0 / #3a2a22
- Semantic (always icon + label, never accent-tinted): `--tip` #2e7d55 · `--crit` (amber) #a76a16 · `--danger` #b23b2e — each also has `-bg` (fill) and `-ink` (text)
- Type: display `--serif` (Iowan Old Style → Palatino → Georgia); body `--sans` (system UI stack); data = monospace
- Scale: every size is a `clamp()` — h1 26→44, h2 21→34, big 19→26, body 17→22px
- Space `--pad` clamp(16, 4.5vw, 32) · Radius ladder 999 / 20 / 14 / 13 / 10px · Shadow `--shadow` (2-layer, warm)

## Class vocabulary

- Buttons: `.btn` (default) · `.btn.pri` (primary / accent) · `.btn.dgr` (destructive), grouped in a `.btnrow`; `.pill2` toggle/filter; `.cataux` icon button
- Callouts: `.call.tip` / `.call.crit` / `.call.danger` (`.ic` icon + `.t` uppercase label)
- Cards: `.vcard` (+`.on` = selected accent ring, +`.add` = add affordance)
- Modal: one bottom sheet — `.sheet` > `.panel` (`.head` + scrollable `.body`), primary action last
- Chat: `.msg.a` / `.msg.u` bubbles; composer `.chatinput` (camera + gallery + auto-growing textarea + send)

## Rules

- One `.btn.pri` per view; terracotta means "the action here."
- Severity reads from `tip` / `crit` / `danger` only — never the accent.
- Tap targets ≥ 44px; primary actions sit bottom-of-sheet or float bottom-right, in thumb reach.
- Respect `prefers-color-scheme`; show a 2px accent focus ring; honor `prefers-reduced-motion`.
- Generated/imported content renders only through typed blocks — never inject model- or import-supplied strings as HTML.

## Minimal snippet

```html
<div class="call crit">
  <span class="ic">🎯</span>
  <div><span class="t">Spec</span>Compressor bolts: 18 lb-ft — verify against the factory manual.</div>
</div>
<div class="btnrow">
  <button class="btn">Cancel</button>
  <button class="btn pri">Save vehicle</button>
</div>
```
