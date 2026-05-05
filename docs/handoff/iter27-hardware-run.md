# Iter27 Hardware Run — Handoff (Sprint13e)

**Owner**: utente con device 9ede6d09 + 4 iBeacon Terrio in 2m range
**ETA**: ~25 min (build APKs once + run + log review)
**Pre-requisites checked at session-end 2026-05-05 21:40 UTC**:

- [x] Docker fleet 21/21 healthy (`docker ps | grep terrio-e2e | grep healthy`)
- [x] Device 9ede6d09 connected via ADB
- [x] ADB reverse 8080+8180 active
- [x] All Sprint13a-f PRs merged (8/9; PR #10 sales-agent widening pending merge)

## Run sequence

```bash
cd ~/Claude/Terrio/terrio-e2e-tests

# 1. Rebuild all APKs from current main (~15 min Gradle)
bash scripts/rebuild-all-apks.sh

# 2. Run iter27 (Sprint13a-f baseline + sales-agent widening)
bash scripts/iter27-runner.sh

# 3. Inspect results
ls -la test-results/iter27-*
cat test-results/iter27-*/SUMMARY.txt
```

## Expected outcome vs iter26 (1/15)

| App / Flow | iter26 | iter27 expected | Why |
|---|---|---|---|
| sales-agent/login | PASS | PASS | unchanged |
| sales-agent/navigation | FAIL | **PASS** | Dashboard → Panoramica widening (PR #10) |
| sales-agent/requests | FAIL | **PASS** | same |
| sales-agent/logout | FAIL | unknown | depends on whether logout had Dashboard hit (already widened in Iter15) |
| consumer/login | PASS | PASS | unchanged |
| consumer/registration-first-scan (NEW) | n/a | **PASS** | TC-CR-001 + CC-001 BE+FE chain ready |
| tenant/* (3 flows) | FAIL | unchanged | core-registry was DEGRADED in iter17 — re-run with healthy fleet should help, but no flow-side fix yet |
| merchant/* (3 flows) | PASS | PASS | unchanged |
| territory/* (3 flows) | FAIL | unchanged | ADB drop in iter17 — runner v17 fixed, should now run; no flow-side fix |

**Best-case score**: 5/15 → 8-10/15 (sales-agent +2, TC-CR-001 +1, tenant maybe +3 if fleet stable)
**Worst-case**: 1/15 → 4/15 (only sales-agent nav+requests + new TC-CR-001 flip)

## Diagnostics if score doesn't move

1. Check `test-results/iter27-*/sales-agent-mobile-navigation.log` — if "Panoramica" still times out, the issue is deeper than label widening (route mount race?)
2. Check `test-results/iter27-*/consumer-mobile-registration-first-scan.log` — TC-CR-001 may fail at sign-up form fields if i18n labels drifted
3. Check `adb logcat | grep -E "TerritoryAssignment|fetchAssignments"` for sales-agent dashboard data fetch — empty assignments may render blank dashboard

## Rollback

If iter27 makes things worse (e.g. timeout 30s causes test runner to spin too long), revert PR #10:

```bash
gh pr revert <merged-PR-number-of-#10>
```

## Hardware (deferred to next iter)

- 50 iBeacon order pending (~€1.000, lead 2 weeks) — until then we run with the 4 dev beacons
- Alt-device for HW-001 chipset comparison still TBD

