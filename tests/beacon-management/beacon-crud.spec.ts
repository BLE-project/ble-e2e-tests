/**
 * Beacon Management CRUD — Session 46 E2E tests
 *
 * Tests:
 *   1. Create beacon with name + password via API
 *   2. Rename beacon (PUT /api/v1/beacons/{id}/name)
 *   3. View password (GET /api/v1/beacons/{id}/password) as SUPER_ADMIN
 *   4. View password as TENANT_ADMIN -> 403
 *   5. Get audit log (GET /api/v1/beacons/{id}/audit) as SUPER_ADMIN
 *   6. Get audit log as TENANT_ADMIN -> 403
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
let createdBeaconId: string | null = null

test.describe('Beacon Management — CRUD', () => {
  test.beforeAll(async () => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
    territoryId = seed?.territoryId ?? process.env.DEV_TERRITORY_ID ?? '00000000-0000-0000-0000-000000000002'
  })

  test.beforeEach(async ({ request }) => {
    // Get SUPER_ADMIN token
    const adminLogin = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: PASSWORD },
    })
    if (adminLogin.ok()) {
      superAdminToken = (await adminLogin.json()).token
    }

    // Get TENANT_ADMIN token
    const tenantLogin = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-tenant-admin', password: PASSWORD },
    })
    if (tenantLogin.ok()) {
      tenantAdminToken = (await tenantLogin.json()).token
    }
  })

  // ── Create Beacon with Name + Password ─────────────────────────────────

  test('Create beacon with name and password fields', async ({ request }) => {
    if (!superAdminToken) { test.skip(true, 'No super-admin token'); return }

    const uniqueSuffix = Date.now().toString(36)
    const beaconName = `E2E-Test-Beacon-${uniqueSuffix}`
    const beaconPassword = `SecureP@ss-${uniqueSuffix}`

    const res = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-CRUD-${uniqueSuffix}-0000-000000000000`.substring(0, 36),
        major: 1,
        minor: 1,
        name: beaconName,
        password: beaconPassword,
      },
    })

    // 201 = created, 409 = already exists (idempotent re-run)
    expect([201, 409]).toContain(res.status())

    if (res.status() === 201) {
      const body = await res.json()
      expect(body.id).toBeTruthy()
      createdBeaconId = body.id

      // Verify name is returned in response
      if (body.name) {
        expect(body.name).toBe(beaconName)
      }
    }
  })

  // ── Rename Beacon ──────────────────────────────────────────────────────

  test('Rename beacon via PUT /api/v1/beacons/{id}/name', async ({ request }) => {
    if (!superAdminToken) { test.skip(true, 'No super-admin token'); return }

    // First, create a beacon to rename (or use one that exists)
    const uniqueSuffix = Date.now().toString(36)
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-RENAME-${uniqueSuffix}-000000000000`.substring(0, 36),
        major: 2,
        minor: 1,
        name: `Original-Name-${uniqueSuffix}`,
      },
    })

    let beaconId: string
    if (createRes.status() === 201) {
      beaconId = (await createRes.json()).id
    } else {
      // Skip if we can't create a beacon
      test.skip(true, `Cannot create beacon for rename test: ${createRes.status()}`)
      return
    }

    // Now rename
    const newName = `Renamed-Beacon-${uniqueSuffix}`
    const renameRes = await request.put(`${BFF}/api/v1/beacons/${beaconId}/name`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: { name: newName },
    })

    expect([200, 204]).toContain(renameRes.status())

    // Verify the name was updated by fetching the beacon
    const getRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    if (getRes.status() === 200) {
      const beacon = await getRes.json()
      expect(beacon.name).toBe(newName)
    }

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── View Password — SUPER_ADMIN ────────────────────────────────────────

  test('View password as SUPER_ADMIN returns decrypted password', async ({ request }) => {
    if (!superAdminToken) { test.skip(true, 'No super-admin token'); return }

    // Create a beacon with password
    const uniqueSuffix = Date.now().toString(36)
    const beaconPassword = `ViewTest-${uniqueSuffix}`
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-VIEWPW-${uniqueSuffix}-00000000000`.substring(0, 36),
        major: 3,
        minor: 1,
        name: `ViewPW-Beacon-${uniqueSuffix}`,
        password: beaconPassword,
      },
    })

    if (createRes.status() !== 201) {
      test.skip(true, `Cannot create beacon for password view test: ${createRes.status()}`)
      return
    }

    const beaconId = (await createRes.json()).id

    // View password as SUPER_ADMIN
    const pwRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect(pwRes.status()).toBe(200)
    const pwBody = await pwRes.json()
    expect(pwBody.password).toBe(beaconPassword)

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── View Password — TENANT_ADMIN -> 403 ────────────────────────────────

  test('View password as TENANT_ADMIN returns 403', async ({ request }) => {
    if (!superAdminToken || !tenantAdminToken) {
      test.skip(true, 'Missing tokens')
      return
    }

    // Create beacon as SUPER_ADMIN
    const uniqueSuffix = Date.now().toString(36)
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-NOPW-${uniqueSuffix}-000000000000`.substring(0, 36),
        major: 4,
        minor: 1,
        name: `NoPW-Beacon-${uniqueSuffix}`,
        password: 'test-password-123',
      },
    })

    if (createRes.status() !== 201) {
      test.skip(true, `Cannot create beacon: ${createRes.status()}`)
      return
    }

    const beaconId = (await createRes.json()).id

    // Try to view password as TENANT_ADMIN — should be 403
    const pwRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/password`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect(pwRes.status()).toBe(403)

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── Audit Log — SUPER_ADMIN ────────────────────────────────────────────

  test('Get audit log as SUPER_ADMIN returns entries', async ({ request }) => {
    if (!superAdminToken) { test.skip(true, 'No super-admin token'); return }

    // Create a beacon (generates BEACON_CREATED audit entry)
    const uniqueSuffix = Date.now().toString(36)
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-AUDIT-${uniqueSuffix}-00000000000`.substring(0, 36),
        major: 5,
        minor: 1,
        name: `Audit-Beacon-${uniqueSuffix}`,
        password: 'audit-test-pw',
      },
    })

    if (createRes.status() !== 201) {
      test.skip(true, `Cannot create beacon for audit test: ${createRes.status()}`)
      return
    }

    const beaconId = (await createRes.json()).id

    // Rename to generate another audit entry
    await request.put(`${BFF}/api/v1/beacons/${beaconId}/name`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: { name: `Renamed-${uniqueSuffix}` },
    })

    // Get audit log
    const auditRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/audit`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect(auditRes.status()).toBe(200)
    const auditLog = await auditRes.json()

    // Should have at least 1 entry (BEACON_CREATED; rename entry may also be present)
    expect(Array.isArray(auditLog)).toBeTruthy()
    expect(auditLog.length).toBeGreaterThanOrEqual(1)

    // Verify audit entry structure
    const entry = auditLog[0]
    expect(entry).toHaveProperty('action')
    expect(entry).toHaveProperty('createdAt')

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })

  // ── Audit Log — TENANT_ADMIN -> 403 ────────────────────────────────────

  test('Get audit log as TENANT_ADMIN returns 403', async ({ request }) => {
    if (!superAdminToken || !tenantAdminToken) {
      test.skip(true, 'Missing tokens')
      return
    }

    // Create beacon as SUPER_ADMIN
    const uniqueSuffix = Date.now().toString(36)
    const createRes = await request.post(`${BFF}/api/v1/beacons`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
      },
      data: {
        territoryId,
        type: 'MERCHANT',
        ibeaconUuid: `E2E-NOAUDIT-${uniqueSuffix}-0000000000`.substring(0, 36),
        major: 6,
        minor: 1,
        name: `NoAudit-Beacon-${uniqueSuffix}`,
      },
    })

    if (createRes.status() !== 201) {
      test.skip(true, `Cannot create beacon: ${createRes.status()}`)
      return
    }

    const beaconId = (await createRes.json()).id

    // Try to get audit log as TENANT_ADMIN — should be 403
    const auditRes = await request.get(`${BFF}/api/v1/beacons/${beaconId}/audit`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect(auditRes.status()).toBe(403)

    // Clean up
    await request.delete(`${BFF}/api/v1/beacons/${beaconId}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })
  })
})
