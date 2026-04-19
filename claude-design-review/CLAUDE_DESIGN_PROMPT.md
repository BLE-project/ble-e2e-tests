# Terrio Platform — UX/UI Design Review Brief

> **For:** Claude Design agent
> **From:** Terrio engineering team
> **Scope:** Full UX/UI audit of 5 mobile apps + identification of improvements
> **Output wanted:** prioritised list of concrete design recommendations (layout,
> interaction, accessibility, information architecture) with Figma-grade mockups
> for the highest-priority items.

---

## 1. Product context in one page

**Terrio** is a multi-tenant BLE-beacon cashback & loyalty platform serving small-to-mid
businesses across multiple geographic markets. Think: **a beacon is placed inside a
merchant's shop. Consumers walk past → app detects the beacon → merchant can trigger
cashback, push an offer, or show a "landing page" with description + photos + social
links**. Territory managers aggregate merchants per city/district. Sales agents
onboard new merchants physically (door-to-door). Tenant admins operate the platform
per-region; super admins moderate cross-tenant.

The platform is **strongly multi-tenant + white-label**: each Tenant owns one or more
Territories, and each Territory can override brand identity (colors, logos, name,
cashback rules) — see §3 below. **An Italian chain and a Spanish chain on the same
platform can look like completely different apps.**

### Five mobile apps, five audiences

| App | User | Primary job | Frequency |
|---|---|---|---|
| **consumer-mobile** | End user walking past shops | Detect nearby merchants, earn cashback, redeem offers | Daily |
| **merchant-mobile** | Shop owner | See own stats, edit landing page, manage beacons, accept loyalty payments | Daily (in-shop) |
| **tenant-mobile** | Regional platform admin | Manage territories, approve/reject merchant landings, configure white-label | Weekly |
| **sales-agent-mobile** | Field sales rep | Visit prospects, enroll beacons on-site, moderate ADV campaigns | Daily (on the road) |
| **territory-mobile** | Territory manager | Oversight of merchants/beacons per territory, KPI dashboard | Daily |

All 5 apps share the **same auth system** (Keycloak OIDC), same API gateway, same
backend services. The **UI stack**: React Native (Expo SDK 54) + TypeScript + expo-router.

---

## 2. What's in this review pack

```
claude-design-review/
├── CLAUDE_DESIGN_PROMPT.md          ← you are here
├── flows/                            ← Maestro flows that produced screenshots
│   ├── consumer-tour.yaml
│   ├── merchant-tour.yaml
│   ├── tenant-tour.yaml
│   ├── sales-agent-tour.yaml
│   └── territory-tour.yaml
├── screenshots/                      ← one screenshot per major screen state
│   ├── consumer/     (01-login, 02-login-filled, 03-home-nearby, 04-wallet, …)
│   ├── merchant/     (01-login, 02-login-filled, 03-dashboard, 04-landing-editor-*, …)
│   ├── tenant/       (01-login, 02-home, 03-territories, 04-beacons, 05-merchants-list, …)
│   ├── sales-agent/  (01-login, 02-home, 03-merchants-list, 04-merchant-detail, …)
│   └── territory/    (01-login, 02-territories-list, 03-territory-detail, …)
└── run-all-tours.sh                  ← regenerate screenshots (requires Maestro)
```

Screenshots are captured from a real Android device (device id shown in each file's
EXIF/metadata is `9ede6d09`). Resolution matches the physical device. The dev
tenant (`ble_tenant_id = 00000000-0000-0000-0000-000000000001`) is active — you're
seeing the **default Terrio brand** (primary `#6C3FCF`, secondary `#1a3f6f`). Other
tenants override this dynamically; we do NOT have screenshots per tenant override
in this pack, but see §3 for how the override system works.

---

## 3. White-label system (critical context)

The platform's biggest UX constraint: **no two deployments look the same**. A
single codebase is themed per-Territory via `BrandingContext` → `useTheme()` hook.
At runtime the consumer-mobile app calls `/bff/v1/consumer/brand` which returns a
resolved `WhiteLabelProfile` JSON, and all theme-able components read from it.

### What's customisable per Territory

| Surface | Customisable | Default |
|---|---|---|
| Primary color | ✅ HEX (WCAG AA contrast enforced) | `#6C3FCF` |
| Secondary color | ✅ HEX | `#1a3f6f` |
| Accent color | ✅ HEX | — |
| Background / text color | ✅ HEX | `#FFFFFF` / `#212121` |
| Logo (light + dark variant) | ✅ PNG/SVG from R2/MinIO | Terrio wordmark |
| Splash screen image | ✅ PNG | Terrio gradient |
| App name override | ✅ 2-30 chars | "Terrio" |
| Map pin marker | ✅ PNG 128×128 | Terrio pin |
| Loyalty card template (front + back) | ✅ PNG 1012×638 | Terrio card |
| Cashback label ("Cashback" / "Punti" / "Miglia") | ✅ | "Cashback" |
| Legal links (privacy, terms) | ✅ URL | Terrio |

### What's NOT customisable (platform invariants)

- Icon set (Ionicons — for consistency across tenants)
- Typography scale (Inter font, 12/14/16/22 sizes)
- Navigation patterns (tab bar on mobile, sidebar on tablet)
- Core iconography meaning (⭐ rating, 📍 location, 💬 chat)
- Error states / fallback UI

### Why this matters for your review

**Do NOT recommend design choices that hardcode brand colors.** Every color must
go through the theme context. Use the Terrio default palette as a reference
(`#6C3FCF` purple / `#1a3f6f` navy) but flag any hardcoded color leak you spot.

**DO focus on layout, spacing, information hierarchy, typography scale usage,
interaction patterns** — these are platform invariants.

---

## 4. Current implementation facts

### What just shipped (v7.9.7 → v7.9.13, April 2026)

1. **T-162 push notifications** — beacon-silent alerts fan out to sales-agent & territory mobile via FCM/APNs (screenshots don't show this explicitly; happens via OS notifications)
2. **Merchant Landing page** — mobile-only editor with:
   - Plain-text description (no markdown editor, simple TextInput multiline, 2000 char cap)
   - 5 **fixed social link fields** (Instagram / Facebook / WhatsApp / Website / TikTok)
   - Logo + cover upload via `expo-image-picker` → Google Vision SafeSearch moderation → R2 storage
   - 9-state moderation flow: `DRAFT → PENDING_AI → {PUBLISHED | PENDING_HUMAN | AUTO_REJECTED}`; rejected merchants can appeal
3. **Tenant moderation UI** — diff-view "Proposta" vs "Attualmente live" with approve / reject / archive actions
4. **AI moderation** via Claude Haiku (text) + Google Vision (image) with per-tenant budget ledger

### Known UX weaknesses we've already spotted (v7.9.13 audit)

- **Tenant-mobile first-publish banner** — when a merchant has never been
  published, the tenant sees only "Proposta" without a confrontation tab.
  We added an info banner ("Prima pubblicazione"); please evaluate if
  clearer copy/icon would help.
- **Reject modal** — cross-platform custom `Modal` + `TextInput` with 0/500
  char counter. Current look is functional; we welcome improvements in
  hierarchy, colors, button positioning.
- **Consumer-mobile "Nearby"** — we auto-start the BLE scanner on mount
  (Fase 3.2). If permission is denied, we show a "Grant permission" state.
  Does the empty/denied state communicate the value proposition clearly?
- **Landing editor in merchant-mobile** — 5 social fields stacked vertically.
  Scrolls may be deep. Is there a smarter grouping?
- **Merchant moderation status badges** — 9 enum values with distinct colors.
  Does the color system degrade gracefully? Any accessibility concern?

---

## 5. What we want from you

**Primary output (priorities in order):**

### 5.1 Global critique (1-2 pages)
- Information hierarchy across the 5 apps — are identifying elements consistent?
- Typography scale — do the 5 apps share the same scale or drift?
- Spacing / padding rhythm — is 8px baseline respected?
- Navigation model (tabs vs stack) — does each app surface its primary job?
- Color usage with the white-label constraint — any accidental hardcoding?

### 5.2 Per-app detailed findings (1 page per app)
For each of consumer / merchant / tenant / sales-agent / territory:
- Top 3 friction points observed in the flow
- Top 3 opportunities for UX improvement (with screen references)
- Any accessibility red flag (contrast, tap targets < 44pt, no visible focus state)

### 5.3 Priority fix list
Rank the top 10 issues **across all apps** by:
- Impact (how often the user hits it × how much friction it adds)
- Effort (rough t-shirt size: XS/S/M/L/XL)
- Risk (what breaks if we change it)

### 5.4 Figma-grade mockups for top 3 priorities
For the 3 highest-priority issues, produce:
- Annotated current-state screenshot ("this is what's wrong and why")
- Proposed improvement as a mockup (Figma frame or equivalent)
- Implementation notes (which component, which props, cascading impact)

### 5.5 White-label stress test
Pick one of the 5 apps' key screens and **re-render it** with three dramatically
different tenant themes:
- Light theme: `primary=#E91E63, secondary=#FFC107` (a fashion brand)
- Dark theme: `primary=#00BCD4, secondary=#00E676` (a tech-bar)
- Pastel theme: `primary=#F8BBD0, secondary=#D1C4E9` (a wellness chain)

Flag any element that breaks (text contrast < 4.5:1, logo overflow, icon
ambiguity, etc.). This stress test alone would be high value.

---

## 6. What NOT to do

- **Don't recommend native iOS or Material Design wholesale adoption.**
  The apps are React Native — we use a custom design system, not Material nor
  HIG out-of-the-box. Aligning selectively is fine.
- **Don't propose changes that require backend schema migrations** (e.g. "add a
  new field to the merchant landing"). Scope is UI only.
- **Don't introduce new third-party dependencies** without flagging it — we
  deliberately minimise Expo native modules for build-pipeline simplicity.
- **Don't assume iOS is the reference.** Android is the higher-volume platform
  for our merchant + sales-agent audiences (cheaper devices, field use). Pixel
  equality matters.

---

## 7. Technical constraints

### Device baseline
- Android: Pixel 6 class (2400×1080, 6.1"), API 33+
- iOS: iPhone 12 class (2532×1170, 6.1"), iOS 16+
- Minimum supported: Android 10 (API 29), iOS 15

### Performance budget
- Mobile JS thread: 60 fps scroll target
- Cold start: ≤ 2.5s to first screen
- Screen transition: ≤ 250ms
- Image loading: progressive placeholder required for R2 assets

### Accessibility
- WCAG AA mandatory (not AAA)
- Dynamic type / font scaling must work without clipping
- Tap targets ≥ 44×44 pt (Android) / 44×44 pt (iOS)
- Screen reader labels required on every actionable element

### Internationalisation
- Italian default, English fallback
- Future: Spanish, Portuguese (European), French
- RTL not planned (Arabic / Hebrew out of scope)
- Date format: locale-respecting via `Intl.DateTimeFormat`

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Territory** | Geographic sub-division owned by a Tenant (e.g. "Milan District") |
| **White-label profile** | Theming + branding override applied per Territory |
| **Beacon** | Bluetooth iBeacon broadcasting UUID/Major/Minor; physical device installed in shop |
| **Landing page** | Merchant's public-facing card — shown to consumer when beacon detected |
| **Moderation status** | One of DRAFT/PENDING_AI/PENDING_HUMAN/APPROVED/PUBLISHED/REJECTED/AUTO_REJECTED/ARCHIVED/ESCALATED_TO_ADMIN |
| **ADV campaign** | Targeted offer sent as push when consumer near a merchant's beacon |
| **Cashback ledger** | Append-only double-entry ledger tracking consumer → merchant loyalty balance |

---

## 9. Timeline + deliverables format

We're aiming for **one sprint** (2 weeks) on your side. Deliver as:
- Markdown document for text content (one file per section above)
- Figma file (view-only link OR exported PNG frames at 2x)
- One summary PR description ready to paste into our engineering tracker

If anything is blocker-ambiguous, open a comment with `DESIGN QUESTION:` and we'll
respond within 24h. If a screen shown to you doesn't match the state machine we
describe here, flag it — we may have documented differently from what shipped.

Thank you! The team is very excited for your output.

— Terrio Platform engineering
