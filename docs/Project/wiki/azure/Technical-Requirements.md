# Technical Requirements (MCP Server)

## TR-A11Y-CONTRAST-001

**WCAG contrast minimums in both themes** — Every text/background and border/graphical-object color pairing meets WCAG 2.2 AA contrast minimums (4.5:1 for normal text, 3:1 for large text, UI components, and graphical objects) in both the light and dark themes; pinch-zoom is not disabled.
Scope: layer-1+

## TR-A11Y-DLG-001

**Modal dialog semantics and focus management** — Every modal (sheet, capture overlay, VIN scanner) exposes role=dialog/aria-modal, moves focus into the dialog on open, traps Tab within it, closes on Escape, and restores focus to the opener on close.
Scope: layer-1+

## TR-A11Y-KBD-001

**Keyboard-operable custom widgets** — All custom interactive widgets (star rating, marketplace/home guide cards, session-log media thumbnails) expose correct ARIA roles/names and are fully operable via keyboard (Tab/Enter/Space/Arrow), with no keyboard-only task blocker.
Scope: layer-1+

## TR-A11Y-LIVE-001

**Live-region status messaging** — Async status and error messages (review/submit/generation/merge status, the voice bar, toast notifications, and the chat log/typing indicator) are exposed to assistive technology via ARIA live regions (role=status/alert/log + aria-live), with focus moved to the offending field on validation error.
Scope: layer-1+

