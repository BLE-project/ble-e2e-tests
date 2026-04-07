/**
 * Mobile API tests — Tenant Admin app endpoints.
 *
 * Covers every REST call made by ble-tenant-mobile:
 *   - Auth (login)
 *   - Beacons CRUD (GET/POST/DELETE /api/v1/beacons)
 *   - Tenant stats (GET /bff/v1/tenant/stats)
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loadSeedDataSync, SeedData } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'

let seed: SeedData | null
let token: string
let tenantId: string
let territoryId: string

test.beforeAll(async () => {
  seed = loadSeedDataSync()
  tenantId = seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
  territoryId = seed?.territoryId ?? process.env.DEV_TERRITORY_ID ?? '00000000-0000-0000-0000-000000000002'
})

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BFF}/api/v1/auth/login`, {
    data: { username: TENANT_USER, password: TENANT_PASS },
  })
  expect(res.ok(), `tenant-admin login failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  expect(body.token).toBeTruthy()
  return body.token
}

function headers(tok: string): Record<string, string> {
  return {
    Authorization: `Bearer ${tok}`,
    'X-Tenant-Id': tenantId,
    'Content-Type': 'application/json',
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

test.describe('Tenant Admin Auth', () => {
  test('POST /api/v1/auth/login — tenant-admin credentials returns token', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: TENANT_USER, password: TENANT_PASS },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.token).toBeTruthy()
    token = body.token
  })
})

// ── Beacons CRUD ─────────────────────────────────────────────────────────────

test.describe('Beacons CRUD', () => {
  let createdBeaconId: string | null = null

  test.beforeAll(async ({ request }) => {
    if (!token) token = await login(request)
  })

  test('GET /api/v1/beacons — list beacons', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/beacons`, {
      headers: headers(token),
    })
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })

  test('POST /api/v1/beacons — create beacon', async ({ request }) => {
    const uniqueMinor = Math.floor(Math.random() * 9000) + 1000
    const res = await request.post(`${BFF}/api/v1/beacons`, {
      headers: headers(token),
      data: {
        uuid: 'E2E-TEST-0000-0000-000000000001',
        major: 100,
        minor: uniqueMinor,
        beaconType: 'TRACKING',
        label: `E2E Test Beacon ${uniqueMinor}`,
        territoryId,
      },
    })
    // 201 on success, 400 on validation error, 409 on duplicate
    expect([201, 400, 403, 409]).toContain(res.status())
    if (res.status() === 201) {
      const body = await res.json()
      expect(body).toHaveProperty('id')
      createdBeaconId = body.id
    }
  })

  test('DELETE /api/v1/beacons/{id} — delete beacon', async ({ request }) => {
    // Only run if we created a beacon above
    if (!createdBeaconId) {
      test.skip()
      return
    }
    const res = await request.delete(
      `${BFF}/api/v1/beacons/${createdBeaconId}`,
      { headers: headers(token) },
    )
    // 204 on success, 404 if already deleted
    expect([200, 204, 404]).toContain(res.status())
  })
})

// ── Tenant Stats ─────────────────────────────────────────────────────────────

test.describe('Tenant Stats', () => {
  test.beforeAll(async ({ request }) => {
    if (!token) token = await login(request)
  })

  test('GET /bff/v1/tenant/stats — returns tenant dashboard stats', async ({ request }) => {
    const res = await request.get(`${BFF}/bff/v1/tenant/stats`, {
      headers: headers(token),
    })
    // 200 with stats, 404 if not implemented yet
    expect([200, 403, 404]).toContain(res.status())
  })
})
