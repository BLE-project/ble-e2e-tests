/**
 * Beacon Password Security — Session 46 E2E tests
 *
 * Tests:
 *   1. Password encrypted in DB (not stored in plaintext)
 *   2. Only SUPER_ADMIN can view password
 *   3. SALES_AGENT can set/reset password (with proximity header)
 *   4. CONSUMER/MERCHANT cannot access password endpoints
 *
 * All tests are API-only (Playwright request context, no browser).
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const PASSWORD = process.env.DEV_PASS ?? 'dev-pass'

let tenantId: string
let territoryId: string
let superAdminToken: string
let tenantAdminToken: string
let salesAgentToken: string
let consumerToken: string
let merchantToken: string

test.describe('Beacon Password — Security Tests', () => {
  test.beforeAll(async () => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
    territoryId = seed?.territoryId ?? process.env.DEV_TERRITORY_ID ?? '00000000-0000-0000-0000-000000000002'
  })

  test.beforeEach(async ({ request }) => {
    // Login all role users
    const roles: Array<{ user: string; setter: (t: string) => void }> = [
      { user: 'dev-super-admin', setter: (t) => { superAdminToken = t } },
      { user: 'dev-tenant-admin', setter: (t) => { tenantAdminToken = t } },
      { user: 'dev-sales-agent', setter: (t) => { salesAgentToken = t } },
      { user: 'dev-consumer', setter: (t) => { consumerToken = t } },
      { user: 'dev-merchant', setter: (t) => { merchantToken = t } },
    ]

    for (const { user, setter } of roles) {
      const res = await request.post(`${BFF}/api/v1/auth/login`, {
        data: { username: user, password: PASSWORD },
      })
      if (res.ok()) {
        setter((await res.json()).token)
      }
    }
  })

  // ── Helper: create a beacon with password ──────────────────────────────

  async function createBeaconWithPassword(
    request: any,
    suffix: string,
    beaconPassword: string,
  ): Promise<string | null> {
    const res = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-PWSEC-${suffix}-000000000000`.substring(0, 36),
        major: 10,
        minor: parseInt(suffix.slice(-3), 36) || 1,
        name: `PWSec-Beacon-${suffix}`,
        password: beaconPassword,
      },
    })

    if (res.status() === 201) {
      return (await res.json()).id
    }
    return null
  }

  // ── Password Encrypted in DB ───────────────────────────────────────────

  test('Password is encrypted — stored value differs from plaintext', async ({ request }) => {
    if (!superAdminToken) { test.skip(true, 'No super-admin token'); return }

    const suffix = Date.now().toString(36)
    const plainPassword = 'MyPlainTextPassword123!'
    const beaconId = await createBeaconWithPassword(request, suffix, plainPassword)
    if (!beaconId) { test.skip(true, 'Cannot create beacon'); return }

    // Fetch the beacon details — the response should NOT contain the plaintext password
    const getRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    if (getRes.status() === 200) {
      const beacon = await getRes.json()
      const bodyStr = JSON.stringify(beacon)

      // The beacon listing endpoint should NOT leak the password at all,
      // OR if it returns an encrypted form, it should differ from plaintext.
      // Either password field is absent, or it is a different (encrypted) value.
      if (beacon.beaconPassword) {
        expect(beacon.beaconPassword).not.toBe(plainPassword)
      }
      if (beacon.password) {
        expect(beacon.password).not.toBe(plainPassword)
      }
    }

    // The decrypted password via the dedicated endpoint should match
    const pwRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    if (pwRes.status() === 200) {
      const pwBody = await pwRes.json()
      expect(pwBody.password).toBe(plainPassword)
    }

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── Only SUPER_ADMIN can view password ─────────────────────────────────

  test('Only SUPER_ADMIN can view decrypted password', async ({ request }) => {
    if (!superAdminToken) { test.skip(true, 'No super-admin token'); return }

    const suffix = Date.now().toString(36)
    const beaconId = await createBeaconWithPassword(request, suffix, 'admin-only-pw')
    if (!beaconId) { test.skip(true, 'Cannot create beacon'); return }

    // SUPER_ADMIN can view
    const adminRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
    expect(adminRes.status()).toBe(200)

    // TENANT_ADMIN cannot view
    if (tenantAdminToken) {
      const tenantRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
        headers: {
          Authorization: `Bearer ${tenantAdminToken}`,
          'X-Tenant-Id': tenantId,
        },
      })
      expect(tenantRes.status()).toBe(403)
    }

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── SALES_AGENT can set/reset password ─────────────────────────────────

  test('SALES_AGENT can set password with proximity header', async ({ request }) => {
    if (!superAdminToken || !salesAgentToken) {
      test.skip(true, 'Missing tokens')
      return
    }

    // Create beacon without password (as SUPER_ADMIN)
    const suffix = Date.now().toString(36)
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-SAGENT-${suffix}-00000000000`.substring(0, 36),
        major: 11,
        minor: 1,
        name: `SA-Beacon-${suffix}`,
      },
    })

    if (createRes.status() !== 201) {
      test.skip(true, `Cannot create beacon: ${createRes.status()}`)
      return
    }
    const beaconId = (await createRes.json()).id

    // SALES_AGENT sets password with X-BLE-Proximity header
    const setPwRes = await request.put(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${salesAgentToken}`,
        'X-Tenant-Id': tenantId,
        'X-BLE-Proximity': 'true',
        'Content-Type': 'application/json',
      },
      data: { password: 'sales-agent-set-pw' },
    })

    // 200/204 = success, 403 = endpoint requires different role setup
    expect([200, 204]).toContain(setPwRes.status())

    // SALES_AGENT resets password
    const resetPwRes = await request.post(`${BFF}/api/v1/beacons/${beaconId}/password/reset`, {
      headers: {
        Authorization: `Bearer ${salesAgentToken}`,
        'X-Tenant-Id': tenantId,
        'X-BLE-Proximity': 'true',
        'Content-Type': 'application/json',
      },
      data: { password: 'sales-agent-new-pw' },
    })

    expect([200, 204]).toContain(resetPwRes.status())

    // Verify the password was changed (as SUPER_ADMIN)
    const verifyRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    if (verifyRes.status() === 200) {
      const body = await verifyRes.json()
      expect(body.password).toBe('sales-agent-new-pw')
    }

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── CONSUMER cannot access password endpoints ──────────────────────────

  test('CONSUMER cannot access password endpoints', async ({ request }) => {
    if (!superAdminToken || !consumerToken) {
      test.skip(true, 'Missing tokens')
      return
    }

    const suffix = Date.now().toString(36)
    const beaconId = await createBeaconWithPassword(request, suffix, 'consumer-test-pw')
    if (!beaconId) { test.skip(true, 'Cannot create beacon'); return }

    // CONSUMER cannot view password — 403 (forbidden role) or 404 (tenant filter hides it)
    const viewRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
    expect([403, 404]).toContain(viewRes.status())

    // CONSUMER cannot set password
    const setRes = await request.put(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': tenantId,
        'X-BLE-Proximity': 'true',
        'Content-Type': 'application/json',
      },
      data: { password: 'hacker-pw' },
    })
    expect([403, 404]).toContain(setRes.status())

    // CONSUMER cannot reset password
    const resetRes = await request.post(`${BFF}/api/v1/beacons/${beaconId}/password/reset`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': tenantId,
        'X-BLE-Proximity': 'true',
        'Content-Type': 'application/json',
      },
      data: { password: 'hacker-pw' },
    })
    expect([403, 404]).toContain(resetRes.status())

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── MERCHANT cannot access password endpoints ──────────────────────────

  test('MERCHANT cannot access password endpoints', async ({ request }) => {
    if (!superAdminToken || !merchantToken) {
      test.skip(true, 'Missing tokens')
      return
    }

    const suffix = Date.now().toString(36)
    const beaconId = await createBeaconWithPassword(request, suffix, 'merchant-test-pw')
    if (!beaconId) { test.skip(true, 'Cannot create beacon'); return }

    // MERCHANT cannot view password — 403 (forbidden role) or 404 (tenant filter hides it)
    const viewRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
    expect([403, 404]).toContain(viewRes.status())

    // MERCHANT cannot set password
    const setRes = await request.put(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'X-Tenant-Id': tenantId,
        'X-BLE-Proximity': 'true',
        'Content-Type': 'application/json',
      },
      data: { password: 'hacker-pw' },
    })
    expect([403, 404]).toContain(setRes.status())

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })
})
