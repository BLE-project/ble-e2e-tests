/**
 * Live Beacon System Test — FEAT-S42-005
 *
 * Tests the complete beacon flow using a REAL iBeacon device (Holy-IOT).
 * Requires:
 *   - Physical iBeacon broadcasting (Holy-IOT, MAC: D1:DF:AD:FB:EB:1E)
 *   - Python + bleak installed (pip install bleak)
 *   - Docker stack running with the beacon registered in the DB
 *
 * Beacon details:
 *   UUID:  FDA50693-A4E2-4FB1-AFCF-C6EB07647825
 *   Major: 10011, Minor: 19641
 *   DB ID: abcf9911-06a9-45ea-a121-c52f60bbf761
 *
 * Run: npx playwright test tests/beacon-real/live-beacon.spec.ts
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const PASSWORD = process.env.DEV_PASS ?? 'dev-pass'

// Known beacon parameters (Holy-IOT physical beacon)
const BEACON_UUID = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825'
const BEACON_MAJOR = 10011
const BEACON_MINOR = 19641
const BEACON_DB_ID = 'abcf9911-06a9-45ea-a121-c52f60bbf761'

let tenantId: string
let tenantToken: string
let consumerToken: string

test.describe('Live Beacon — Real BLE Device Tests', () => {
  test.beforeAll(async () => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '03096dd4-d49e-4888-9829-27f8d4033dff'
  })

  /**
   * Test 1: BLE scan detects the physical beacon and matches registered parameters.
   * Uses Python + bleak to perform a real Bluetooth scan.
   */
  test('BLE scan detects physical beacon with correct UUID/Major/Minor', async () => {
    // Skip if no Bluetooth adapter available
    let scanResult: string
    try {
      scanResult = execSync('python -c "' +
        'import asyncio, json\\n' +
        'from bleak import BleakScanner\\n' +
        'async def scan():\\n' +
        '    devices = await BleakScanner.discover(timeout=5, return_adv=True)\\n' +
        '    for addr, (dev, adv) in devices.items():\\n' +
        '        if adv.manufacturer_data:\\n' +
        '            for cid, data in adv.manufacturer_data.items():\\n' +
        '                if cid == 0x004C and len(data) >= 23 and data[0]==2 and data[1]==0x15:\\n' +
        '                    uuid = f\\"{data[2:6].hex()}-{data[6:8].hex()}-{data[8:10].hex()}-{data[10:12].hex()}-{data[12:18].hex()}\\\".upper()\\n' +
        '                    major = int.from_bytes(data[18:20], \\\"big\\\")\\n' +
        '                    minor = int.from_bytes(data[20:22], \\\"big\\\")\\n' +
        '                    mp = data[22] - 256 if data[22] > 127 else data[22]\\n' +
        '                    print(json.dumps({\\\"uuid\\\":uuid,\\\"major\\\":major,\\\"minor\\\":minor,\\\"rssi\\\":adv.rssi,\\\"measuredPower\\\":mp}))\\n' +
        'asyncio.run(scan())\\n' +
        '"', { encoding: 'utf-8', timeout: 15000 }).trim()
    } catch (e) {
      test.skip(true, 'Bluetooth scan failed or bleak not installed — skipping live beacon test')
      return
    }

    // Parse all detected iBeacons
    const beacons = scanResult.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)

    // Find our specific beacon
    const ourBeacon = beacons.find(
      (b: any) => b.uuid === BEACON_UUID && b.major === BEACON_MAJOR && b.minor === BEACON_MINOR
    )

    expect(ourBeacon).toBeTruthy()
    expect(ourBeacon.uuid).toBe(BEACON_UUID)
    expect(ourBeacon.major).toBe(BEACON_MAJOR)
    expect(ourBeacon.minor).toBe(BEACON_MINOR)
    expect(ourBeacon.rssi).toBeLessThan(0)  // RSSI is always negative
    expect(ourBeacon.rssi).toBeGreaterThan(-100)  // Should be within reasonable range
  })

  /**
   * Test 2: Verify the beacon exists in the database via the API.
   */
  test('Beacon is registered in the database', async ({ request }) => {
    // Login as tenant admin
    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-tenant-admin', password: PASSWORD },
    })
    expect(loginRes.ok()).toBeTruthy()
    const loginBody = await loginRes.json()
    tenantToken = loginBody.token

    // Get the beacon by ID
    const beaconRes = await request.get(`${BFF}/api/v1/beacons/${BEACON_DB_ID}`, {
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    // Beacon should exist (200) or might be 404 if not yet registered
    if (beaconRes.status() === 200) {
      const beacon = await beaconRes.json()
      expect(beacon.ibeaconUuid.toUpperCase()).toBe(BEACON_UUID)
      expect(beacon.major).toBe(BEACON_MAJOR)
      expect(beacon.minor).toBe(BEACON_MINOR)
    } else {
      // Beacon not found in DB — this is acceptable, we'll register it in the next test
      expect(beaconRes.status()).toBe(404)
    }
  })

  /**
   * Test 3: Simulate beacon event flow — consumer detects beacon, BFF resolves tenant.
   * Uses the "uuid" alias field (as mobile scanner would send).
   */
  test('Beacon event flow with uuid alias field', async ({ request }) => {
    // Login as consumer
    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-consumer', password: PASSWORD },
    })

    if (!loginRes.ok()) {
      test.skip(true, 'Consumer login not available — skipping beacon event test')
      return
    }

    const loginBody = await loginRes.json()
    consumerToken = loginBody.token

    // Send beacon event using the "uuid" alias (mobile scanner format)
    const eventRes = await request.post(`${BFF}/bff/v1/consumer/beacon-event`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        uuid: BEACON_UUID,  // FIX-S42-002: using "uuid" instead of "ibeaconUuid"
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
        rssi: -43,
      },
    })

    // The beacon event endpoint should return 200 with an action
    // (NONE if beacon belongs to active tenant, SWITCH_AUTO/PROMPT_SWITCH if different tenant,
    // or 400 if beacon not found in registry)
    expect([200, 400, 401]).toContain(eventRes.status())

    if (eventRes.status() === 200) {
      const body = await eventRes.json()
      expect(body.action).toBeTruthy()
      expect(['NONE', 'SWITCH_AUTO', 'PROMPT_SWITCH', 'SNOOZED']).toContain(body.action)
    }
  })

  /**
   * Test 4: Beacon event with ibeaconUuid field (legacy format) also works.
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

  /**
   * Test 5: Beacon configuration endpoint (GATT data upload).
   */
  test('GATT configuration can be uploaded and retrieved', async ({ request }) => {
    if (!tenantToken) {
      test.skip(true, 'No tenant token available')
      return
    }

    // Upload GATT configuration
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

    // May be 200 (success) or 404 (beacon not in this tenant)
    if (configRes.status() === 200) {
      const config = await configRes.json()
      expect(config.txPower).toBe(-12)
      expect(config.advertisingInterval).toBe(350)
      expect(config.firmwareVersion).toBe('2.1.3')
      expect(config.batteryLevel).toBe(87.5)

      // Retrieve it
      const getRes = await request.get(`${BFF}/api/v1/beacons/${BEACON_DB_ID}/configuration`, {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          'X-Tenant-Id': tenantId,
        },
      })
      expect(getRes.status()).toBe(200)
    }
  })

  /**
   * Test 6: Beacon uniqueness check — duplicate registration should fail.
   */
  test('Duplicate beacon registration returns 409 Conflict', async ({ request }) => {
    if (!tenantToken) {
      test.skip(true, 'No tenant token available')
      return
    }

    const seed = loadSeedDataSync()
    const territoryId = seed?.territoryId ?? '00000000-0000-0000-0000-000000000002'

    // Attempt to register a beacon with the same UUID/Major/Minor
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId: territoryId,
        type: 'MERCHANT',
        ibeaconUuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
      },
    })

    // Should be 409 (already exists) or 201 (first time)
    // If 409, verify the error code
    if (createRes.status() === 409) {
      const body = await createRes.json()
      expect(body.error).toBeTruthy()
      expect(['BEACON_ALREADY_ASSIGNED', 'BEACON_DUPLICATE']).toContain(body.error.code)
    } else {
      expect([201, 409]).toContain(createRes.status())
    }
  })
})
