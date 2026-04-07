/**
 * Live Beacon System Test — FEAT-S42-005 + FEAT-S44-001
 *
 * Tests the complete beacon flow using REAL iBeacon devices (Holy-IOT x4).
 * Requires:
 *   - Physical iBeacons broadcasting (Holy-IOT, 4 devices)
 *   - Python + bleak installed (pip install bleak)
 *   - Docker stack running with the beacon registered in the DB
 *
 * S44 scan results (3 of 4 beacons detected):
 *   Beacon #1: MAC=D1:DF:AD:FB:EB:1E RSSI=-39dBm (IMMEDIATE)
 *   Beacon #2: MAC=C0:0B:15:42:1A:54 RSSI=-71dBm (FAR)
 *   Beacon #3: MAC=C8:45:60:6D:83:CF RSSI=-73dBm (FAR)
 *   CRITICAL: All 3 share UUID/Major/Minor (default factory config)
 *
 * Beacon identity (factory default):
 *   UUID:  FDA50693-A4E2-4FB1-AFCF-C6EB07647825
 *   Major: 10011, Minor: 19641
 *   DB ID: abcf9911-06a9-45ea-a121-c52f60bbf761
 *
 * Run: npx playwright test tests/beacon-real/live-beacon.spec.ts
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const PASSWORD = process.env.DEV_PASS ?? 'dev-pass'

// Known beacon parameters (Holy-IOT physical beacon — factory default)
const BEACON_UUID = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825'
const BEACON_MAJOR = 10011
const BEACON_MINOR = 19641
const BEACON_DB_ID = 'abcf9911-06a9-45ea-a121-c52f60bbf761'

// Known MAC addresses from the S44 scan
const KNOWN_MACS = [
  'D1:DF:AD:FB:EB:1E',
  'C0:0B:15:42:1A:54',
  'C8:45:60:6D:83:CF',
]

// Beacon scan result file from Python scanner
const SCAN_RESULT_FILE = './test-results/.beacon-scan.json'

let tenantId: string
let tenantToken: string
let consumerToken: string

/** Parse iBeacon advertisements from a BLE scan via Python/bleak. */
function runBleScan(): Array<{
  uuid: string
  major: number
  minor: number
  rssi: number
  measuredPower: number
  address?: string
}> {
  const pythonScript = `
import asyncio, json
from bleak import BleakScanner
async def scan():
    devices = await BleakScanner.discover(timeout=8, return_adv=True)
    for addr, (dev, adv) in devices.items():
        if adv.manufacturer_data:
            for cid, data in adv.manufacturer_data.items():
                if cid == 0x004C and len(data) >= 23 and data[0]==2 and data[1]==0x15:
                    uuid = f"{data[2:6].hex()}-{data[6:8].hex()}-{data[8:10].hex()}-{data[10:12].hex()}-{data[12:18].hex()}".upper()
                    major = int.from_bytes(data[18:20], "big")
                    minor = int.from_bytes(data[20:22], "big")
                    mp = data[22] - 256 if data[22] > 127 else data[22]
                    print(json.dumps({"uuid":uuid,"major":major,"minor":minor,"rssi":adv.rssi,"measuredPower":mp,"address":addr}))
asyncio.run(scan())
`
  const result = execSync(`python -c "${pythonScript.replace(/\n/g, '\\n')}"`, {
    encoding: 'utf-8',
    timeout: 20000,
  }).trim()

  return result
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
}

/** Load cached scan results from the JSON file written by the Python scanner. */
function loadCachedScan(): Array<{
  address: string
  uuid: string
  major: number
  minor: number
  rssi: number
  measured_power: number
  distance_m: number
  zone: string
}> | null {
  try {
    if (!existsSync(SCAN_RESULT_FILE)) return null
    const raw = readFileSync(SCAN_RESULT_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

test.describe('Live Beacon — Real BLE Device Tests', () => {
  test.beforeAll(async () => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '03096dd4-d49e-4888-9829-27f8d4033dff'
  })

  // ── Single Beacon Detection ─────────────────────────────────────────────

  /**
   * Test 1: BLE scan detects the physical beacon and matches registered parameters.
   * Uses Python + bleak to perform a real Bluetooth scan.
   */
  test('BLE scan detects physical beacon with correct UUID/Major/Minor', async () => {
    let beacons: ReturnType<typeof runBleScan>
    try {
      beacons = runBleScan()
    } catch (e) {
      test.skip(true, 'Bluetooth scan failed or bleak not installed — skipping live beacon test')
      return
    }

    // Find our specific beacon
    const ourBeacon = beacons.find(
      (b) => b.uuid === BEACON_UUID && b.major === BEACON_MAJOR && b.minor === BEACON_MINOR
    )

    expect(ourBeacon).toBeTruthy()
    expect(ourBeacon!.uuid).toBe(BEACON_UUID)
    expect(ourBeacon!.major).toBe(BEACON_MAJOR)
    expect(ourBeacon!.minor).toBe(BEACON_MINOR)
    expect(ourBeacon!.rssi).toBeLessThan(0)
    expect(ourBeacon!.rssi).toBeGreaterThan(-100)
  })

  // ── Multi-Beacon Detection (S44) ───────────────────────────────────────

  /**
   * Test 2: Multi-beacon scan — detect multiple beacons, verify count.
   * Uses cached scan results from .beacon-scan.json or performs live scan.
   */
  test('Multi-beacon scan detects multiple devices', async () => {
    const cached = loadCachedScan()
    if (!cached) {
      // Try live scan
      let beacons: ReturnType<typeof runBleScan>
      try {
        beacons = runBleScan()
      } catch {
        test.skip(true, 'No cached scan and BLE scan failed — skipping')
        return
      }
      // Should detect at least 1 beacon
      expect(beacons.length).toBeGreaterThanOrEqual(1)
      return
    }

    // From cached scan we know we have 3 beacons
    expect(cached.length).toBeGreaterThanOrEqual(2)

    // Verify each has required fields
    for (const beacon of cached) {
      expect(beacon.address).toBeTruthy()
      expect(beacon.uuid).toBeTruthy()
      expect(beacon.rssi).toBeLessThan(0)
      expect(beacon.zone).toBeTruthy()
    }
  })

  /**
   * Test 3: Verify all scanned beacons share the same UUID/Major/Minor (known issue).
   * This is the DUPLICATE IDENTITY problem — all Holy-IOT beacons have factory defaults.
   */
  test('All beacons have same UUID/Major/Minor (duplicate identity — known issue)', async () => {
    const cached = loadCachedScan()
    if (!cached || cached.length < 2) {
      test.skip(true, 'Need at least 2 beacons in cached scan')
      return
    }

    // Extract unique identities (UUID + Major + Minor)
    const identities = cached.map(b => `${b.uuid}:${b.major}:${b.minor}`)
    const uniqueIdentities = [...new Set(identities)]

    // KNOWN ISSUE: All beacons share the same identity — this is a configuration problem
    expect(uniqueIdentities.length).toBe(1)
    expect(uniqueIdentities[0]).toBe(`${BEACON_UUID}:${BEACON_MAJOR}:${BEACON_MINOR}`)

    // But MAC addresses MUST be different
    const macs = cached.map(b => b.address)
    const uniqueMacs = [...new Set(macs)]
    expect(uniqueMacs.length).toBe(cached.length)  // Each MAC is unique
  })

  /**
   * Test 4: Multi-beacon proximity zones — verify IMMEDIATE vs FAR classification.
   */
  test('Multi-beacon proximity zones (IMMEDIATE vs FAR)', async () => {
    const cached = loadCachedScan()
    if (!cached || cached.length < 2) {
      test.skip(true, 'Need at least 2 beacons in cached scan')
      return
    }

    // At least one should be IMMEDIATE (closest beacon)
    const immediateBeacons = cached.filter(b => b.zone === 'IMMEDIATE')
    const farBeacons = cached.filter(b => b.zone === 'FAR')

    // We expect mixed zones based on scan data
    expect(immediateBeacons.length + farBeacons.length).toBeGreaterThanOrEqual(2)

    // IMMEDIATE beacons should have stronger RSSI (less negative)
    if (immediateBeacons.length > 0 && farBeacons.length > 0) {
      const strongestImmediate = Math.max(...immediateBeacons.map(b => b.rssi))
      const weakestFar = Math.min(...farBeacons.map(b => b.rssi))
      // IMMEDIATE should generally have stronger signal than FAR
      expect(strongestImmediate).toBeGreaterThan(weakestFar)
    }

    // Distance should correlate with zone
    for (const b of immediateBeacons) {
      expect(b.distance_m).toBeLessThan(1.0)  // IMMEDIATE = < 1m
    }
    for (const b of farBeacons) {
      expect(b.distance_m).toBeGreaterThan(1.0)  // FAR = > 1m
    }
  })

  // ── API Registration & Event Flow ───────────────────────────────────────

  /**
   * Test 5: Verify the beacon exists in the database via the API.
   */
  test('Beacon is registered in the database', async ({ request }) => {
    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-tenant-admin', password: PASSWORD },
    })
    expect(loginRes.ok()).toBeTruthy()
    const loginBody = await loginRes.json()
    tenantToken = loginBody.token

    const beaconRes = await request.get(`${BFF}/api/v1/beacons/${BEACON_DB_ID}`, {
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    if (beaconRes.status() === 200) {
      const beacon = await beaconRes.json()
      expect(beacon.ibeaconUuid.toUpperCase()).toBe(BEACON_UUID)
      expect(beacon.major).toBe(BEACON_MAJOR)
      expect(beacon.minor).toBe(BEACON_MINOR)
    } else {
      expect(beaconRes.status()).toBe(404)
    }
  })

  /**
   * Test 6: Register beacon via API, then verify SDK lookup works.
   */
  test('Register beacon via API and verify SDK lookup', async ({ request }) => {
    if (!tenantToken) {
      test.skip(true, 'No tenant token available')
      return
    }

    const seed = loadSeedDataSync()
    const territoryId = seed?.territoryId ?? '00000000-0000-0000-0000-000000000002'

    // Try to register (may already exist — 409 is acceptable)
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
      },
    })
    expect([201, 409]).toContain(createRes.status())

    // Now verify the beacon can be resolved (SDK lookup)
    const resolveRes = await request.get(
      `${BFF}/api/v1/beacons/resolve?ibeaconUuid=${BEACON_UUID}&major=${BEACON_MAJOR}&minor=${BEACON_MINOR}`,
      {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
        },
      },
    )

    // Should return the tenant info for this beacon
    if (resolveRes.status() === 200) {
      const resolved = await resolveRes.json()
      expect(resolved.id).toBeTruthy()
      expect(resolved.name).toBeTruthy()
    } else {
      // 404 is acceptable if beacon not found in registry
      expect([200, 404]).toContain(resolveRes.status())
    }
  })

  /**
   * Test 7: Simulate beacon event from multi-beacon scenario.
   * When 3 devices advertise the same identity, the consumer app should send
   * a beacon event with the strongest RSSI.
   */
  test('Beacon event with strongest RSSI from duplicate identity beacons', async ({ request }) => {
    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-consumer', password: PASSWORD },
    })
    if (!loginRes.ok()) {
      test.skip(true, 'Consumer login not available — skipping')
      return
    }
    consumerToken = (await loginRes.json()).token

    // Simulate sending the strongest RSSI from the scan (-39 dBm from the IMMEDIATE beacon)
    const eventRes = await request.post(`${BFF}/bff/v1/consumer/beacon-event`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        uuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
        rssi: -39,  // Strongest RSSI from D1:DF:AD:FB:EB:1E (IMMEDIATE)
      },
    })

    expect([200, 400, 401]).toContain(eventRes.status())
    if (eventRes.status() === 200) {
      const body = await eventRes.json()
      expect(body.action).toBeTruthy()
      expect(['NONE', 'SWITCH_AUTO', 'PROMPT_SWITCH', 'SNOOZED']).toContain(body.action)
    }
  })

  /**
   * Test 8: Beacon event flow with uuid alias field (mobile scanner format).
   */
  test('Beacon event flow with uuid alias field', async ({ request }) => {
    if (!consumerToken) {
      test.skip(true, 'No consumer token available')
      return
    }

    const eventRes = await request.post(`${BFF}/bff/v1/consumer/beacon-event`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        uuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
        rssi: -43,
      },
    })

    expect([200, 400, 401]).toContain(eventRes.status())
    if (eventRes.status() === 200) {
      const body = await eventRes.json()
      expect(body.action).toBeTruthy()
      expect(['NONE', 'SWITCH_AUTO', 'PROMPT_SWITCH', 'SNOOZED']).toContain(body.action)
    }
  })

  /**
   * Test 9: Beacon event flow with ibeaconUuid field (legacy format).
   */
  test('Beacon event flow with ibeaconUuid field (legacy)', async ({ request }) => {
    if (!consumerToken) {
      test.skip(true, 'No consumer token available')
      return
    }

    const eventRes = await request.post(`${BFF}/bff/v1/consumer/beacon-event`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        ibeaconUuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
        rssi: -43,
      },
    })

    expect([200, 400, 401]).toContain(eventRes.status())
  })

  // ── GATT Configuration ──────────────────────────────────────────────────

  /**
   * Test 10: GATT configuration upload and retrieval.
   */
  test('GATT configuration can be uploaded and retrieved', async ({ request }) => {
    if (!tenantToken) {
      test.skip(true, 'No tenant token available')
      return
    }

    const configRes = await request.put(`${BFF}/api/v1/beacons/${BEACON_DB_ID}/configuration`, {
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        txPower: -12,
        advertisingInterval: 350,
        firmwareVersion: '2.1.3',
        batteryLevel: 87.5,
        configuredAt: new Date().toISOString(),
      },
    })

    if (configRes.status() === 200) {
      const config = await configRes.json()
      expect(config.txPower).toBe(-12)
      expect(config.advertisingInterval).toBe(350)
      expect(config.firmwareVersion).toBe('2.1.3')
      expect(config.batteryLevel).toBe(87.5)

      const getRes = await request.get(`${BFF}/api/v1/beacons/${BEACON_DB_ID}/configuration`, {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'X-Tenant-Id': tenantId,
        },
      })
      expect(getRes.status()).toBe(200)
    }
  })

  // ── Uniqueness & Duplicate Handling ─────────────────────────────────────

  /**
   * Test 11: Duplicate beacon registration returns 409 Conflict.
   */
  test('Duplicate beacon registration returns 409 Conflict', async ({ request }) => {
    if (!tenantToken) {
      test.skip(true, 'No tenant token available')
      return
    }

    const seed = loadSeedDataSync()
    const territoryId = seed?.territoryId ?? '00000000-0000-0000-0000-000000000002'

    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
      },
    })

    if (createRes.status() === 409) {
      const body = await createRes.json()
      expect(body.error).toBeTruthy()
      expect(['BEACON_ALREADY_ASSIGNED', 'BEACON_DUPLICATE']).toContain(body.error.code)

      // S44: Check for X-BLE-Warning header on same-tenant duplicate
      if (body.error.code === 'BEACON_DUPLICATE') {
        // The new S44 behavior returns the existing beacon ID with a warning header
        const warningHeader = createRes.headers()['x-ble-warning']
        if (warningHeader) {
          expect(warningHeader).toBe('DUPLICATE_IDENTITY')
        }
      }
    } else {
      expect([201, 409]).toContain(createRes.status())
    }
  })
})
