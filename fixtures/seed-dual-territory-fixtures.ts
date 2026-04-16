/**
 * Fase 3.0b.4: Dual-territory seed fixtures.
 *
 * Purpose:
 *   Set up the minimum database state required to exercise the beacon
 *   reconfigure + territory-switch flow end-to-end (Fase 3.0b.6 Maestro
 *   flow `beacon-reconfig-switch.yaml`).
 *
 * What it creates (idempotent — reuses existing rows by name match):
 *   - Tenant             "E2E Dev Tenant"          (via ensureSeedData)
 *   - Territory A        "E2E Territory A (Alpha)"
 *   - Territory B        "E2E Territory B (Beta)"
 *   - Beacon α           enrolled into Territory A with a fixed triple
 *   - Beacon β           enrolled into Territory B with a fixed triple
 *
 * The fixed triples are intentionally distinct so the initial state never
 * hits the backend's (uuid, major, minor) UNIQUE constraint, and tests can
 * then call PUT /v1/beacons/{id} to SWITCH one beacon to the other's
 * territory, optionally via `randomizeBeaconIdentity()` to avoid collisions.
 *
 * Usage from Playwright / scripts:
 *   import { ensureDualTerritoryFixtures } from './seed-dual-territory-fixtures'
 *   const f = await ensureDualTerritoryFixtures()
 *   // f.territoryAId / f.territoryBId / f.beaconAlphaId / f.beaconBetaId
 *
 * Usage from CLI (one-shot local seeding):
 *   npx tsx fixtures/seed-dual-territory-fixtures.ts
 */
import { ensureSeedData } from './seed-data'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

// Canonical IDs — hard-coded UUID/major/minor so repeated runs are stable.
// Use a recognizable "E2E0..." prefix so you can spot them in the DB dump.
const TERRITORY_A_NAME = 'E2E Territory A (Alpha)'
const TERRITORY_B_NAME = 'E2E Territory B (Beta)'

const BEACON_ALPHA = {
  name: 'E2E Alpha Beacon',
  ibeaconUuid: 'E2E00000-0000-4000-A000-000000000001',
  major: 10001,
  minor: 1,
  type: 'MERCHANT' as const,
}

const BEACON_BETA = {
  name: 'E2E Beta Beacon',
  ibeaconUuid: 'E2E00000-0000-4000-B000-000000000002',
  major: 20002,
  minor: 2,
  type: 'MERCHANT' as const,
}

export interface DualTerritoryFixtures {
  token: string
  tenantId: string
  territoryAId: string
  territoryAName: string
  territoryBId: string
  territoryBName: string
  beaconAlphaId: string
  beaconBetaId: string
}

let _cache: DualTerritoryFixtures | null = null

/**
 * Idempotently ensure the dual-territory fixtures exist. Results cached for
 * the lifetime of the Node process.
 */
export async function ensureDualTerritoryFixtures(): Promise<DualTerritoryFixtures> {
  if (_cache) return _cache

  const base = await ensureSeedData()
  const { token, tenantId } = base

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  }

  // 1. Territory A ─ find or create
  const territoryAId = await findOrCreateTerritory(headers, TERRITORY_A_NAME, tenantId)
  // 2. Territory B ─ find or create
  const territoryBId = await findOrCreateTerritory(headers, TERRITORY_B_NAME, tenantId)

  // 3. Beacon α in Territory A
  const beaconAlphaId = await findOrCreateBeacon(headers, {
    ...BEACON_ALPHA,
    territoryId: territoryAId,
  })

  // 4. Beacon β in Territory B
  const beaconBetaId = await findOrCreateBeacon(headers, {
    ...BEACON_BETA,
    territoryId: territoryBId,
  })

  _cache = {
    token,
    tenantId,
    territoryAId,
    territoryAName: TERRITORY_A_NAME,
    territoryBId,
    territoryBName: TERRITORY_B_NAME,
    beaconAlphaId,
    beaconBetaId,
  }
  return _cache
}

// ── Internals ───────────────────────────────────────────────────────────────

async function findOrCreateTerritory(
  headers: Record<string, string>,
  name: string,
  tenantId: string,
): Promise<string> {
  const listRes = await fetch(`${BFF_URL}/api/v1/territories`, { headers })
  if (listRes.ok) {
    const list = (await listRes.json()) as Array<{ id: string; name: string }>
    const existing = list.find(t => t.name === name)
    if (existing) return existing.id
  }
  const createRes = await fetch(`${BFF_URL}/api/v1/territories`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, tenantId, visibility: 'public', territoryType: 'standard' }),
  })
  if (!createRes.ok) {
    throw new Error(`Create territory "${name}" failed: ${createRes.status} ${await createRes.text()}`)
  }
  const created = (await createRes.json()) as { id: string }
  return created.id
}

interface BeaconSeed {
  territoryId: string
  // Must match src/main/java/com/ble/core/beacon/BeaconType.java — backend
  // rejects any value outside this 3-value enum with a 400.
  type: 'MERCHANT' | 'TRACKING' | 'TOURIST_INFO'
  ibeaconUuid: string
  major: number
  minor: number
  name: string
}

async function findOrCreateBeacon(
  headers: Record<string, string>,
  seed: BeaconSeed,
): Promise<string> {
  // Find by identity triple first — the (uuid, major, minor) tuple is unique.
  const listRes = await fetch(`${BFF_URL}/api/v1/beacons`, { headers })
  if (listRes.ok) {
    const list = (await listRes.json()) as Array<{
      id: string
      ibeaconUuid: string
      major: number
      minor: number
    }>
    const existing = list.find(
      b =>
        b.ibeaconUuid.toUpperCase() === seed.ibeaconUuid.toUpperCase() &&
        b.major === seed.major &&
        b.minor === seed.minor,
    )
    if (existing) return existing.id
  }

  const createRes = await fetch(`${BFF_URL}/api/v1/beacons`, {
    method: 'POST',
    headers,
    body: JSON.stringify(seed),
  })
  if (!createRes.ok) {
    throw new Error(
      `Create beacon "${seed.name}" failed: ${createRes.status} ${await createRes.text()}`,
    )
  }
  const created = (await createRes.json()) as { id: string }
  return created.id
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
//
// Support `npx tsx fixtures/seed-dual-territory-fixtures.ts` so a dev can
// prime the local DB without running the full Playwright suite. Uses the same
// detection trick as Node: only run when this module IS the entrypoint.

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /seed-dual-territory-fixtures\.(ts|js)$/.test(process.argv[1])

if (isDirectRun) {
  ensureDualTerritoryFixtures()
    .then(f => {
      // Keep stdout parseable for shell scripts that want to eval the output.
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(f, null, 2))
      process.exit(0)
    })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error('[seed-dual-territory] FAILED:', err)
      process.exit(1)
    })
}
