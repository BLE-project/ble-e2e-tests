# Maestro on-device E2E — handoff (2026-06-02)

Resume guide for the on-device (Android `9ede6d09`) Maestro suite. The **systemic
backend/data/APK work is DONE + merged**; what remains is **per-flow
maintenance** + **data fixtures**.

---

## 1. Current state (what's done)

### Backend / data — production-correct + merged
- `ble-core-registry#65/#67/#68` — cross-tenant IDOR + mandatory `ble_tenant_id` claim.
- `ble-core-registry#69` (**V34**) — `GRANT ble_app_role ON consumer_tenant_context` → `GET /v1/federation/context` 500→404 (consumer "Nearby" unblocked).
- `ble-core-registry#70` — `GET /v1/tenants` bind RLS + `@Transactional` + SUPER_ADMIN lists all + `ORDER BY createdAt`. Was returning `[]` under FORCE RLS → seed kept creating duplicate tenants.
- **Data dedup**: 3 duplicate "E2E Dev Tenant" soft-deleted → only canonical **`7d224640`** (owns the 9 active FDA50693 beacons + territory `8112bd70` "Ter2") + Default.
- **Claim alignment**: all `dev-*` users' `ble_tenant_id` = `7d224640` (via global-setup; the Keycloak `ble_tenant_id` protocol-mapper on `ble-identity` client is created by global-setup).
- **5 mobile apps rebuilt via EAS** (profile `previewLocal`, gateway `127.0.0.1:8080`) from main + installed. Sentry/eas.json fix merged: merchant#59/#60, consumer#101/#102, tenant#57/#58, territory#36/#37, sales-agent#52/#53.
- **App-token blocker RESOLVED**: the fresh EAS APK sends a claimed token (the old local APK did not). Verified: federation/context 404→200, zero `no ble_tenant_id claim` 403 for consumer/beacon-scan.

### Flow fixes — branch `fix/e2e-fresh-install-gates`, PR `ble-e2e-tests#57`
- `consumer-mobile/_gates.yaml` — shared fresh-install gate subflow (biometric dismiss + IT/EN permission drain + FU-10 BLE consent). `runFlow`'d in the consumer flows.
- Green now: consumer `beacon-scan`, `registration-first-scan`, `login`, `logout`, `navigation`; merchant `cashback-config`, `login`, `logout`, `pos-scan`, **`navigation`**; tenant `login`, `logout`, `navigation`; sales-agent `login`, `navigation`, `requests`; territory `login`, `territory-list`.
- sales-agent moderation/bcn/beacon flows hardened (sentinel + login + Esci) — now reach the Moderazioni list; blocked only on the moderation data fixture.

---

## 2. Environment resume (run these first)

```bash
# Stack is in terrio-e2e-compose (docker compose). BFF is on HOST port 8082.
# Device reaches the stack via adb reverse 8080 -> 8082:
adb -s 9ede6d09 reverse tcp:8080 tcp:8082

# Re-seed + re-align claims (idempotent; reuses 7d224640 thanks to #70 + the
# deleted .seed-data.json cache). IMPORTANT: delete the cache or it reuses a
# stale tenant id:
cd terrio-e2e-tests
rm -f test-results/.seed-data.json
cat > _ra.mts <<'TS'
import * as m from './global-setup.ts'
const fn=(m as any).default?.default ?? (m as any).default
;(async()=>{ await fn(); })()
TS
BFF_URL=http://localhost:8082 KC_URL=http://localhost:8180 \
  ADMIN_USER=dev-super-admin ADMIN_PASS=dev-pass npx tsx _ra.mts; rm -f _ra.mts
# Verify a user's claim == 7d224640:
curl -s -X POST http://localhost:8082/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"dev-tenant-admin","password":"dev-pass"}' \
  | python3 -c 'import sys,json,base64;t=json.load(sys.stdin)["token"];print(json.loads(base64.urlsafe_b64decode(t.split(".")[1]+"=="))["ble_tenant_id"])'
```

Run a single flow:
```bash
export PATH="$HOME/.maestro/bin:$PATH"
adb -s 9ede6d09 shell pm clear it.terrio.<app>   # consumer|merchant|tenant|salesagent|territory
timeout 200 maestro --device 9ede6d09 test maestro/<app>-mobile/<flow>.yaml
```

> NOTE the suite runner must NOT `pkill -f maestro` from inside its own command
> (the command line contains `maestro --device ...` -> it self-kills). Kill stale
> JVMs by PID instead.

---

## 3. The robustness recipe (apply to each failing flow's preamble)

1. Dismiss biometric: `runFlow when visible "Accesso piu rapido" -> pressKey Back`.
2. Drain OS permission dialogs (device locale is **IT**): repeat ~3-5x tapping `"Esatta|Precise"` then `"Mentre usi l'app|While using the app|Solo questa volta|Consenti|Allow"`.
3. (consumer only) FU-10 BLE consent: `runFlow when id consent-continue -> tap consent-toggle; tap consent-continue`. Already in `consumer-mobile/_gates.yaml`.
4. Settle-wait on an **actionable** element (login button OR a dashboard tile), not the header text (which renders first).
5. Between login inputs: `hideKeyboard` + dismiss Gboard `"Clipboard"` overlay (it covered password-input -> empty password -> login fail).
6. Login screen sentinel must include the app's actual login copy (case-sensitive substring): e.g. sales-agent = `TERRIO Sales|Assistenza merchant`, tenant = `TERRIO Tenant|Tenant admin portal`, merchant = `Gestisci il tuo negozio|Accedi`.
7. Sidebar items below the fold (merchant DS-004 sidebar is now a ScrollView, #58): `scrollUntilVisible` targets the content pane, NOT the narrow sidebar — use a coordinate `swipe: start 8%,75% end 8%,30%` then tap.

---

## 4. Prioritized backlog (next session)

### P0 — data fixtures (each unblocks a batch)
- **`fixtures/seed-moderation-queue.ts` fails with `GET /v1/merchants 401`** — fix the fixture's auth (it logs in via ensureSeedData's dev-super-admin; the merchants GET 401s). Once green it unblocks sales-agent `moderation-approve/reject/escalate/budget-degraded` (4 flows, already structurally fixed — they reach the Moderazioni list and only miss "in attesa" data).
- **`fixtures/seed-custom-branding-fixtures.ts`** — PUT the "E2E Brand" branding row on `7d224640`; unblocks consumer `custom-branding` (currently reaches Nearby, fails on `brand-tag`).

### P1 — per-flow assert/state drift (apply recipe + fix asserts)
- **merchant `adv-appeal/adv-list-filter/adv-submit/adv-takedown`** — land on the persisted dashboard (not login); the recipe was attempted but they need dashboard-vs-login state handling + the `seed-moderation-queue`/ADV data. The preamble does an unconditional `tab-account -> btn-logout -> login`; harden it like sales-agent (biometric/perm/settle, broaden the logout label, ensure ADV REJECTED data seeded).
- **merchant `bcn-map-gps-capture`** — GPS capture (location perm + map).
- **consumer `beacon-scan-background`** (background mode), `merchant-landing` (tap `"Discover|Esplora|Cerca"` drift), `notification-preferences` (assert `"Preferenze|Settings"` drift). Each: `_gates` is already runFlow'd; fix the post-login literal asserts to current copy.
- **sales-agent `bcn-map-gps-capture`, `beacon-first-config`** — login now hardened; fix the feature-screen asserts/testIDs.
- **tenant `beacons`** (territory 8112bd70 now under 7d224640 → create should work with claimed token; verify), `moderation-tenant-review` (needs moderation data + asserts).
- **territory `logout`, `navigation`, `territory-crud`** — apply recipe + fix asserts; territory has no BLE consent.

### P2 — flakiness
- pm-clear races the immediate relaunch (app sometimes shows persisted dashboard/biometric on "fresh" launch). The recipe's biometric+logout-if-Home handling mitigates; a small settle/retry helps.

---

## 5. Key gotchas
- BFF host port = **8082** (not 8080); flows use 8080 on-device via `adb reverse`.
- Delete `test-results/.seed-data.json` before re-seeding or it reuses a stale tenant id (this caused the f39bf6bb vs 7d224640 mismatch).
- Device locale is **Italian** — permission dialog buttons are IT (`Consenti`, `Mentre usi l'app`, `Esatta`, `Solo questa volta`).
- `pm grant <perm>` is refused on this unrooted device (`SecurityException: GRANT_RUNTIME_PERMISSIONS`) — must drain dialogs in-flow.
- Maestro subflow files (`_gates.yaml`) MUST start with a config section (`appId: ...` then `---`).
- True per-flow tally needs `pm clear` between flows (state carryover inflates failures), but that re-triggers all the fresh-install gates each time.
