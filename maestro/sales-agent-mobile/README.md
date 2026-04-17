# sales-agent-mobile Maestro flows

## Active flows (4)

- **`login.yaml`** — username/password login + logout-first guard.
- **`logout.yaml`** — logout from Profilo tab.
- **`navigation.yaml`** — full bottom tab navigation (Home / Richieste / Merchant / Royalties / Beacon / Profilo).
- **`requests.yaml`** — request detail lifecycle (PENDING→IN_REVIEW→APPROVED→kit).

## Disabled flow (S56)

- **`beacon-reconfig-switch.yaml.disabled`** — FEAT-S56-002 requires the
  seed script `fixtures/seed-dual-territory-fixtures.ts` to be executed
  against the live BFF before the flow runs. The seed creates the
  "E2E Alpha Beacon" and "E2E Beta Beacon" cards needed by the flow;
  without them the first `assertVisible` fails.
  Re-enable after wiring the fixture into the test harness (e.g. from
  `scripts/run-maestro-all.sh` via a pre-step call to
  `npx tsx fixtures/seed-dual-territory-fixtures.ts`).

  Also replaces the deprecated Maestro `containerDescendants` selector
  (Unknown Property in Maestro 2.4.0) with `index: 0`; re-validate the
  mapping when Alpha is not guaranteed to be the first card.
