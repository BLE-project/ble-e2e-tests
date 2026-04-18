# iOS Maestro suite — §18 master plan

## Scope

Parity with the 24 Android Maestro flows for the 5 mobile apps, adapted
for iOS 17 simulator / TestFlight builds.

## Directory layout

```
maestro/
  consumer-mobile-ios/
  merchant-mobile-ios/          ✓ adv-submit, adv-appeal, adv-takedown
  tenant-mobile-ios/
  sales-agent-mobile-ios/       ✓ moderation-{approve,reject,escalate,budget-degraded}
  territory-mobile-ios/
```

Currently ported: **7 moderation + ADV flows** (matching §9bis M8 scope).
Remaining base flows (login, navigation, beacons, etc.) to be ported in S60.

## Differences from Android

| Android | iOS | Handling |
|---|---|---|
| `content-desc` on tab bar | `accessibilityLabel` | same `text:` matcher works |
| Runtime permission dialog | cap-set at install | no dismiss needed |
| `am kill-all` between apps | `xcrun simctl terminate` | see runner script |
| Hardware back | swipe gesture | `pressKey BACK` → `swipeLeft` (not used in moderation flows) |

## Run command

```bash
# One-off
maestro test maestro/sales-agent-mobile-ios/moderation-approve.yaml

# Suite (requires macOS host or cloud runner)
for dir in maestro/*-mobile-ios; do
  maestro test "$dir/"
done
```

## CI wiring

See `.github/workflows/ios-build.yml` (S60). Until then these flows are
runnable only on a developer's local macOS + Xcode 16 setup.

## Test fixtures

Same as Android (shared between platforms):
- `dev-sales-agent` / `dev-pass` for sales-agent
- `dev-merchant`   / `dev-pass` for merchant-mobile
- TOTP dev fixture accepts `123456`
- Seeded moderation queue with 1+ PENDING_HUMAN ADV via:
  `npx tsx fixtures/seed-moderation-queue.ts` (TBD in S58)
