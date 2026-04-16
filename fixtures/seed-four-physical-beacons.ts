/**
 * Fase 3.1: Seed the 4 physical Holy-IOT beacons in the E2E tenant.
 *
 * The hardware reconfiguration step (Fase 3.1) originally assumed somebody
 * would walk up to each beacon with the Holy-IOT Android app and flash a
 * new UUID/major/minor. Since that's a physical task and the user asked us
 * to do the reconfiguration in software, this script enrolls 4 beacon
 * records in the backend with canonical identities that match what the
 * hardware *should* broadcast. Once the physical units are flashed to the
 * same triples (or cloned into a closed-circuit territory), the mobile apps
 * will resolve them against these records.
 *
 * BeaconType enum (src/main/java/com/ble/core/beacon/BeaconType.java) only
 * accepts three values: MERCHANT, TOURIST_INFO, TRACKING. The 4 physical
 * units therefore span 3 distinct types with H-04 repeating TRACKING but
 * on a different (uuid, major, minor) triple so test coverage stays high.
 *
 * What it creates (idempotent — reuses existing rows by identity triple):
 *   - Tenant:    "E2E Dev Tenant"        (via ensureSeedData)
 *   - Territory: "E2E Test Territory"    (reuses the default seed territory)
 *   - 4 beacons:
 *       H-01  TRACKING      Ingresso Principale   uuid=E2E10000-…-01 / 11001 / 1
 *       H-02  MERCHANT      Cassa Bar             uuid=E2E10000-…-02 / 11002 / 2
 *       H-03  TOURIST_INFO  Punto Info            uuid=E2E10000-…-03 / 11003 / 3
 *       H-04  TRACKING      Uscita Parcheggio     uuid=E2E10000-…-04 / 11004 / 4
 *
 * The first path segment of each UUID ("E2E10000") makes them trivially
 * greppable in the DB or in mobile logs. Major/minor are set to distinct
 * values in the 11000+ range so they can't collide with the dual-territory
 * fixtures (which use 10001/20002).
 *
 * Usage from CLI:
 *   npx tsx fixtures/seed-four-physical-beacons.ts
 *
 * Usage programmatically:
 *   import { ensureFourPhysicalBeacons } from './seed-four-physical-beacons'
 *   const { beacons } = await ensureFourPhysicalBeacons()
 */
import { ensureSeedData } from './seed-data'
// DEFAULT_HOLYIOT_PASSWORD lives in ./holy-iot-constants.ts and is surfaced
// in the admin-web / sales-agent reconfigure modals as a placeholder. It is
// NOT written to the beacon_password column on seed — each enrollment flow
// in the UI will store it encrypted per-beacon if the operator chooses to.

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

export interface PhysicalBeaconSeed {
  code: 'H-01' | 'H-02' | 'H-03' | 'H-04'
  name: string
  type: 'TRACKING' | 'MERCHANT' | 'TOURIST_INFO'
  ibeaconUuid: string
  major: number
  minor: number
}

export const FOUR_PHYSICAL_BEACONS: PhysicalBeaconSeed[] = [
  {
    code: 'H-01',
    name: 'Holy-IOT H-01 — Ingresso Principale',
    type: 'TRACKING',
    ibeaconUuid: 'E2E10000-0000-4000-A000-000000000001',
    major: 11001,
    minor: 1,
  },
  {
    code: 'H-02',
    name: 'Holy-IOT H-02 — Cassa Bar',
    type: 'MERCHANT',
    ibeaconUuid: 'E2E10000-0000-4000-A000-000000000002',
    major: 11002,
    minor: 2,
  },
  {
    code: 'H-03',
    name: 'Holy-IOT H-03 — Punto Info',
    type: 'TOURIST_INFO',
    ibeaconUuid: 'E2E10000-0000-4000-A000-000000000003',
    major: 11003,
    minor: 3,
  },
  {
    code: 'H-04',
    name: 'Holy-IOT H-04 — Uscita Parcheggio',
    type: 'TRACKING',
    ibeaconUuid: 'E2E10000-0000-4000-A000-000000000004',
    major: 11004,
    minor: 4,
  },
]

export interface FourPhysicalBeaconsResult {
  token: string
  tenantId: string
  territoryId: string
  beacons: Array<{ code: PhysicalBeaconSeed['code']; id: string; created: boolean }>
}

let _cache: FourPhysicalBeaconsResult | null = null

export async function ensureFourPhysicalBeacons(): Promise<FourPhysicalBeaconsResult> {
  if (_cache) return _cache

  const base = await ensureSeedData()
  const { token, tenantId, territoryId } = base

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  }

  // Fetch current beacon list once — we'll look up each triple in-memory
  // instead of hitting the list endpoint 4x.
  const listRes = await fetch(`${BFF_URL}/api/v1/beacons`, { headers })
  if (!listRes.ok) {
    throw new Error(`GET /api/v1/beacons failed: ${listRes.status} ${await listRes.text()}`)
  }
  const existing = (await listRes.json()) as Array<{
    id: string
    ibeaconUuid: string
    major: number
    minor: number
  }>

  const results: FourPhysicalBeaconsResult['beacons'] = []

  for (const b of FOUR_PHYSICAL_BEACONS) {
    const already = existing.find(
      e =>
        e.ibeaconUuid.toUpperCase() === b.ibeaconUuid.toUpperCase() &&
        e.major === b.major &&
        e.minor === b.minor,
    )
    if (already) {
      results.push({ code: b.code, id: already.id, created: false })
      continue
    }
    const createRes = await fetch(`${BFF_URL}/api/v1/beacons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        territoryId,
        type: b.type,
        ibeaconUuid: b.ibeaconUuid,
        major: b.major,
        minor: b.minor,
        name: b.name,
      }),
    })
    if (!createRes.ok) {
      throw new Error(
        `Create beacon ${b.code} failed: ${createRes.status} ${await createRes.text()}`,
      )
    }
    const created = (await createRes.json()) as { id: string }
    results.push({ code: b.code, id: created.id, created: true })
  }

  _cache = { token, tenantId, territoryId, beacons: results }
  return _cache
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /seed-four-physical-beacons\.(ts|js)$/.test(process.argv[1])

if (isDirectRun) {
  ensureFourPhysicalBeacons()
    .then(r => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(r, null, 2))
      process.exit(0)
    })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error('[seed-four-physical-beacons] FAILED:', err)
      process.exit(1)
    })
}
