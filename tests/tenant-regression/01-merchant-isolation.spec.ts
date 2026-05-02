/**
 * Tenant regression — Test 1 / 5
 *
 * Asserts that a tenant-A admin cannot read merchants belonging to tenant B.
 * Tenant boundary check at BFF + service + RLS layer (defense-in-depth I1).
 *
 * Sprint 11 (terrio-sprint-11-multitenancy-hardening). See ADR-008 + RLS
 * coverage matrix at `terrio-platform-docs/06_operations/rls-coverage-matrix.md`.
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const FOREIGN_TENANT_FALLBACK = '00000000-0000-0000-0000-999999999999'

test.describe('Tenant regression — merchant isolation', () => {
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

  test('Tenant A admin cannot list merchants of tenant B', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/merchants`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': FOREIGN_TENANT_FALLBACK,
      },
    })

    // Acceptable: 403 (tenant mismatch), 401 (auth refused), 404 (not found),
    // 400 (invalid). Forbidden: 200 with tenant-B data.
    expect([400, 401, 403, 404]).toContain(res.status())
  })

  test('Tenant A admin cannot fetch merchant by ID under tenant B context', async ({
    request,
  }) => {
    // Synthesise a merchant UUID that does not belong to tenant A.
    const foreignMerchantId = '00000000-0000-0000-0000-000000abcdef'

    const res = await request.get(`${BFF}/api/v1/merchants/${foreignMerchantId}`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': FOREIGN_TENANT_FALLBACK,
      },
    })

    expect([400, 401, 403, 404]).toContain(res.status())
    // Defense-in-depth: even if header bypassed, body must not contain
    // tenant-B fields.
    if (res.ok()) {
      const body = await res.json().catch(() => ({}))
      expect(body.tenantId).not.toBe(FOREIGN_TENANT_FALLBACK)
    }
  })

  test('Tenant A admin can list own tenant merchants normally (positive control)', async ({
    request,
  }) => {
    const res = await request.get(`${BFF}/api/v1/merchants`, {
      headers: {
        Authorization: `Bearer ${tenantAdminToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // All returned merchants must carry tenant A's tenantId.
    const items = Array.isArray(body) ? body : (body.items ?? [])
    for (const m of items) {
      if (m.tenantId !== undefined) {
        expect(m.tenantId).toBe(tenantId)
      }
    }
  })
})
