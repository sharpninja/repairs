# Getting "Repairs" onto Google Play and the Apple App Store

Context this checklist is built around: `docs/index.html` is a fully offline-first PWA
(camera/mic/video capture, IndexedDB media storage, VIN barcode scan, Google Sign-In,
direct browser calls to `api.anthropic.com` with a user-supplied key, and a strict CSP).
That shape matters for both stores — see the "app-specific" callouts below.

---

## 0. The one fact that decides your whole approach

| | Google Play | Apple App Store |
|---|---|---|
| Accepts a PWA as-is? | **Yes** — via Trusted Web Activity (TWA), a Chrome-rendered wrapper | **No** — Guideline 4.2 explicitly rejects "repackaged websites." A thin WebView shell is a common rejection reason. |
| Practical path | Wrap with **Bubblewrap** or **PWABuilder** → Android App Bundle (`.aab`) | Wrap with **PWABuilder's iOS generator** or **Capacitor**, then add genuine native functionality before submitting, to survive 4.2 review |

**Bottom line:** Android is close to "package and ship." iOS needs you to budget time for
adding a few real native touches (push notifications, native share sheet, Sign in with
Apple, haptics, etc.) on top of the wrapped web view, or expect rejection/resubmission
cycles.

---

## 1. Google Play Store

### Prerequisites
- [ ] Google account with 2‑Step Verification enabled
- [ ] Non-prepaid credit/debit card
- [ ] Government-issued ID (for identity verification)
- [ ] Decide **Personal** vs **Organization** account (cannot switch later)
  - Organization needs a **D‑U‑N‑S number** (apply free at dnb.com; takes days–weeks)
- [ ] A live HTTPS domain hosting the PWA that you control (needed for Digital Asset Links / TWA trust)
- [ ] App icon (512×512 PNG), feature graphic (1024×500), phone + tablet screenshots
- [ ] Privacy policy hosted at a public URL
- [ ] Content rating questionnaire answers ready
- [ ] Data safety disclosure ready (see app-specific notes below)

### Cost
| Item | Cost |
|---|---|
| Play Console registration | **$25 USD, one-time** (no renewal) |
| Packaging tooling (Bubblewrap/PWABuilder) | Free |
| D‑U‑N‑S number (Organization accounts only) | Free |
| Closed testing (Personal accounts) | Free, but costs **time**: 12 testers for 14 continuous days is now mandatory |
| Optional: paid design/ASO help | $0–$500+ |

### Checklist
1. [ ] Register Play Console account, pay $25, complete ID verification (24–48h typical)
2. [ ] Package the PWA as a **Trusted Web Activity**:
   - `npx @bubblewrap/cli init --manifest=https://sharpninja.github.io/repairs/docs/manifest.webmanifest` (or use pwabuilder.com's Android option)
   - Host `.well-known/assetlinks.json` on your domain to prove domain ↔ app ownership
   - Confirm a **Lighthouse PWA score of 80+** (installability, HTTPS, service worker) — run `lighthouse` against the live Pages URL before packaging
3. [ ] Sign the `.aab` with a release keystore (back this up — losing it blocks future updates)
4. [ ] Create the app listing: title, short/long description, category, contact email, screenshots
5. [ ] Fill out **Data safety** section — declare what's collected/shared (see below) and that it's not sold
6. [ ] Complete the content rating questionnaire (IARC)
7. [ ] Run the mandatory **closed test**: 12 opted-in testers, 14 days minimum, before Google allows production release
8. [ ] Verify you have access to a physical Android device via the Play Console app (new-account requirement)
9. [ ] Submit for production review (review is usually hours to a few days)
10. [ ] After launch: keep the TWA's `assetlinks.json` and manifest in sync if the domain or icons change; bump the app's `versionCode` on each update

### App-specific notes for this repo
- The CSP already pins `connect-src` to `api.anthropic.com`, `accounts.google.com`, `raw.githubusercontent.com`, and the submit backend — a TWA renders through real Chrome, so this keeps working unchanged.
- Data safety form should disclose: camera/mic/video (stored on-device only, not uploaded), Google Sign-In (only if the submit backend is enabled), and that the Anthropic API key the user enters is stored only in-browser and used to call `api.anthropic.com` directly.
- Since capture features (camera/mic/BarcodeDetector) require a **secure context**, your production domain must serve over HTTPS with no mixed content — GitHub Pages already satisfies this.

---

## 2. Apple App Store

### Prerequisites
- [ ] Apple ID for the account holder
- [ ] A **Mac with Xcode** (no way around this — Apple requires a native Xcode-built binary)
- [ ] Apple Developer Program enrollment ($99/yr — see below)
- [ ] Organization enrollment additionally needs: legal entity, D‑U‑N‑S number, and authority to bind the org legally
- [ ] App icons at all required sizes, screenshots for each supported device class (6.9", 6.5", 5.5" iPhone sizes + iPad if supported)
- [ ] Privacy policy URL
- [ ] Support URL / contact
- [ ] A plan for the **minimum-functionality** requirement (Guideline 4.2) — see below
- [ ] `PrivacyInfo.xcprivacy` manifest (mandatory since May 2024) declaring data types collected and any "required-reason" APIs used (e.g., UserDefaults, file timestamps, disk space)

### Cost
| Item | Cost |
|---|---|
| Apple Developer Program | **$99/year** (Individual or Organization) — auto-renews |
| Apple Developer Enterprise Program | $299/year (internal distribution only — not for public App Store, not relevant here) |
| Mac hardware (if you don't already own one) | $0 if you have one; otherwise buy/rent one |
| App Store commission on any paid content | 30% standard, 15% under the Small Business Program (<$1M/yr revenue) |
| Nonprofits/education/government | Can request a **fee waiver** |
| Optional: design/ASO/legal help | $200–$2,000+ |

### Checklist
1. [ ] Enroll in the Apple Developer Program, pay $99, wait for verification (24–48h individual, 1–2 weeks organization)
2. [ ] Register an **App ID** / Bundle ID in the developer portal
3. [ ] Generate the iOS wrapper project:
   - PWABuilder → "Store Package" → iOS, from `https://sharpninja.github.io/repairs/` (pulls manifest, generates a WKWebView-based Xcode project), **or**
   - Rebuild with **Capacitor**, embedding the existing `docs/index.html` and adding real native plugins
4. [ ] **Add genuine native functionality** before submitting, to clear Guideline 4.2 ("minimum functionality"/no repackaged websites):
   - Native camera/photo capture via `Capacitor Camera` (rather than only the web `getUserMedia`)
   - Push notifications (Apple Push Notification service) for repair reminders
   - Native share sheet, haptics, or Sign in with Apple
   - If you keep Google Sign-In for the submit feature, Apple requires you **also offer Sign in with Apple** as an equivalent option (App Review Guideline 4.8)
5. [ ] Add `PrivacyInfo.xcprivacy` describing camera, microphone, photo library, and any analytics/third‑party SDK data use
6. [ ] Configure Apple Pay/Universal Links/App-Bound Domains in the Xcode project only if you actually use them
7. [ ] Build and archive in Xcode, upload to **App Store Connect**
8. [ ] Fill out App Privacy "nutrition label" questions in App Store Connect (data collected, linked to identity, used for tracking — none of the on-device-only capture data needs to be listed as "collected" since nothing leaves the device, but the Anthropic API calls and Google Sign-In should be disclosed accurately)
9. [ ] Run a **TestFlight** beta (internal testers immediately, external testers after a light Beta App Review) — strongly recommended before full submission
10. [ ] Submit for App Review (typical turnaround 24–72 hours, longer for apps touching AI/regulated categories or on first rejection)
11. [ ] After approval: manage the $99/yr renewal; if it lapses, the app is pulled from the Store after a grace period

### App-specific notes for this repo
- This app is a strong Guideline 4.2 risk case: `docs/index.html` is currently a browser-only experience. Budget real engineering time to bolt on at least 2–3 genuine native capabilities (push notifications for repair-session reminders would be a natural, useful one) rather than shipping a bare WKWebView wrapper.
- iOS Safari's `BarcodeDetector` support and camera/mic permission model differ from Chrome; the VIN barcode scan and MediaRecorder-based capture should be tested specifically in the wrapped WKWebView, since WKWebView doesn't always expose the same web platform APIs as Safari itself.
- The "your own Anthropic API key, entered once" model is fine for review, but be precise in the privacy nutrition label: the key and the resulting prompts leave the device to `api.anthropic.com`, which counts as data being sent to a third party even though Apple/you never see it.
- IndexedDB-stored media never leaving the device is a genuine privacy positive — call it out explicitly in your privacy policy since it simplifies the nutrition-label answers.

---

## 3. Costs, side by side

| | Google Play | Apple App Store |
|---|---|---|
| Store account | $25 one-time | $99/year |
| Packaging tool | Free (Bubblewrap/PWABuilder) | Free (PWABuilder/Capacitor), but needs a Mac + Xcode |
| Mandatory testing gate | 12 testers × 14 days (Personal accounts) | TestFlight beta (optional but wise) |
| Extra engineering to pass review | Usually none beyond packaging | Native feature additions likely required (4.2) |
| Design/legal/ASO (optional, both stores) | $0–$500+ | $0–$2,000+ |
| Ongoing | $0 | $99/year renewal |

---

## 4. Shared prerequisites for both stores

- [ ] A stable production HTTPS domain (GitHub Pages URL already qualifies)
- [ ] A hosted privacy policy covering: on-device storage of photos/voice/video, the user-supplied Anthropic API key and its use, Google Sign-In (if the submit backend is live), and the GitHub PR submission flow
- [ ] Finalized app icon set and screenshots
- [ ] A support/contact email or URL
- [ ] Versioning plan (Play uses `versionCode`/`versionName`; Apple uses `CFBundleVersion`/`CFBundleShortVersionString`) so future updates to `docs/index.html` map cleanly to store releases
