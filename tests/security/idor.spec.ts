/**
 * Security tests — Insecure Direct Object Reference (IDOR)
 *
 * Verifies that the API enforces tenant isolation and role-based access control.
 * Users must not access data belonging to other tenants, and lower-privilege
 * roles must not reach admin-only endpoints.
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'

test.describe('Security — IDOR (Insecure Direct Object Reference)', () => {
  let tenantAdminToken: string
  let consumerToken: string
  let merchantToken: string
  let tenantId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'

    // Login as tenant admin
    const taRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-tenant-admin', password: 'dev-pass' },
    })
    expect(taRes.ok()).toBeTruthy()
    tenantAdminToken = (await taRes.json()).token

    // Login as consumer
    const cRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-consumer', password: 'dev-pass' },
    })
    expect(cRes.ok()).toBeTruthy()
    consumerToken = (await cRes.json()).token

    // Login as merchant
    const mRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-merchant', password: 'dev-pass' },
    })
    expect(mRes.ok()).toBeTruthy()
    merchantToken = (await mRes.json()).token
  })

  test('Cross-tenant data access — tenant admin cannot access another tenant', async ({
    request,
  }) => {
    // Use a fake tenant ID that the tenant-admin does NOT belong to
    const otherTenantId = '00000000-0000-0000-0000-999999999999'

    const res = await request.get(`${BFF}/api/v1/tenants/${otherTenantId}`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': otherTenantId,
      },
    })

    // Should be 403 (forbidden) or 404 (not found) — never 200 with another tenant's data
    expect([400, 401, 403, 404]).toContain(res.status())
  })

  test('Tenant ID mismatch — JWT tenant vs header tenant should not return other tenant data', async ({
    request,
  }) => {
    // tenant-admin's JWT has tenant A, but we send X-Tenant-Id for a different tenant
    const differentTenantId = '00000000-0000-0000-0000-888888888888'

    const res = await request.get(`${BFF}/api/v1/stores`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': differentTenantId,
      },
    })

    // Backend should reject (403), return empty result (200 with []), or not found (404)
    // The key assertion: must NOT return another tenant's actual data
    // 500 would indicate unhandled error
    expect(res.status()).toBeLessThan(500)

    if (res.ok()) {
      // If 200, result should be empty (no cross-tenant data leak)
      const body = await res.json()
      if (Array.isArray(body)) {
        // Empty or only own-tenant data is acceptable
        expect(body.length).toBe(0)
      }
    }
  })

  test('Consumer cannot access admin tenant list endpoint', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/tenants`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    // Consumer role should not be allowed to list all tenants
    expect([401, 403]).toContain(res.status())
  })

  test('Consumer cannot access user management endpoint', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/users`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    // User management is admin-only
    expect([401, 403]).toContain(res.status())
  })

  test('Merchant cannot access tenant admin endpoints', async ({ request }) => {
    const adminEndpoints = [
      '/api/v1/tenants',
      '/api/v1/users',
      '/api/v1/territories',
    ]

    for (const path of adminEndpoints) {
      const res = await request.get(`${BFF}${path}`, {
        headers: {
          Authorization: `Bearer ${merchantToken}`,
          'X-Tenant-Id': tenantId,
        },
      })

      // Merchant should not access admin-only endpoints
      expect([401, 403]).toContain(res.status())
    }
  })

  test('Consumer cannot create a tenant', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/tenants`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
      },
      data: { name: 'Hacked Tenant', contactEmail: 'hacker@evil.com' },
    })

    expect([401, 403]).toContain(res.status())
  })

  test('Merchant cannot delete a store belonging to a different tenant', async ({
    request,
  }) => {
    const fakeStoreId = '00000000-0000-0000-0000-999999999999'
    const res = await request.delete(`${BFF}/api/v1/stores/${fakeStoreId}`, {
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    // Should be 403 or 404 — never 200/204
    expect([400, 401, 403, 404]).toContain(res.status())
  })
})
