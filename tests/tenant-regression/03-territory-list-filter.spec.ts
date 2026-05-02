/**
 * Tenant regression — Test 3 / 5
 *
 * Asserts that GET /api/v1/territories under tenant A returns only
 * tenant-A territories. Verifies core-registry RLS V21 + repository-layer
 * tenant_id WHERE clause. Defense-in-depth (RLS + app-layer filter).
 *
 * Sprint 11 (terrio-sprint-11-multitenancy-hardening).
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const FOREIGN_TENANT_FALLBACK = '00000000-0000-0000-0000-999999999999'

test.describe('Tenant regression — territory list filtering', () => {
  let tenantAdminToken: string
  let tenantId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'

    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-tenant-admin', password: 'dev-pass' },
    })
    expect(loginRes.ok()).toBeTruthy()
    tenantAdminToken = (await loginRes.json()).token
  })

  test('Listing territories under tenant A returns only tenant-A territories', async ({
    request,
  }) => {
    const res = await request.get(`${BFF}/api/v1/territories`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    const items = Array.isArray(body) ? body : (body.items ?? [])

    // Every territory must belong to tenant A — never tenant B.
    for (const t of items) {
      if (t.tenantId !== undefined) {
        expect(t.tenantId).toBe(tenantId)
      }
    }
  })

  test('Listing territories with foreign X-Tenant-Id is rejected', async ({
    request,
  }) => {
    const res = await request.get(`${BFF}/api/v1/territories`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': FOREIGN_TENANT_FALLBACK,
      },
    })

    expect([400, 401, 403, 404]).toContain(res.status())
    if (res.ok()) {
      const body = await res.json()
      const items = Array.isArray(body) ? body : (body.items ?? [])
      // Defense-in-depth: response must NOT contain tenant-A territories.
      for (const t of items) {
        if (t.tenantId !== undefined) {
          expect(t.tenantId).not.toBe(tenantId)
        }
      }
    }
  })

  test('Territory detail across tenants is rejected', async ({ request }) => {
    // Synthetic territory UUID that should not be reachable cross-tenant.
    const foreignTerritoryId = '00000000-0000-0000-0000-aaaaaaaaaaaa'

    const res = await request.get(`${BFF}/api/v1/territories/${foreignTerritoryId}`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': FOREIGN_TENANT_FALLBACK,
      },
    })

    expect([400, 401, 403, 404]).toContain(res.status())
  })
})
