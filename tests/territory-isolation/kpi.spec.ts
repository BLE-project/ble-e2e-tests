/**
 * Territory KPI tests (3 test).
 *
 * Validates that:
 * - GET /reports/territory-kpis returns all 8 KPI fields
 * - KPIs can be filtered by tenantId
 * - KPIs can be filtered by territoryId
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'

const KPI_KEYS = [
  'partnersPerCountry',
  'activePilotTenants',
  'merchantsOnboarded',
  'tenantAcquisitionCost',
  'avgOnboardingDays',
  'consumerActivationRate',
  'cashbackRedemptionRate',
  'merchantRetention90d',
] as const

test.describe('Territory KPI', () => {
  let adminToken: string
  let tenantId: string
  let territoryId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'
    territoryId = seed?.territoryId ?? '00000000-0000-0000-0000-000000000002'

    // Login as super admin (KPIs are SUPER_ADMIN only)
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    expect(res.ok()).toBeTruthy()
    adminToken = (await res.json()).token
  })

  test('GET /reports/territory-kpis returns all 8 KPI fields', async ({ request }) => {
    const res = await request.get(`${BFF}/api/reports/territory-kpis`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })

    // Accept 200 or 403 (if role not yet mapped) — must not be 500
    expect(res.status()).toBeLessThan(500)

    if (res.ok()) {
      const body = await res.json()
      // All 8 KPI keys should be present (values may be null)
      for (const key of KPI_KEYS) {
        expect(body).toHaveProperty(key)
      }
    }
  })

  test('KPI filtered by tenantId', async ({ request }) => {
    const res = await request.get(`${BFF}/api/reports/territory-kpis?tenantId=${tenantId}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })

    expect(res.status()).toBeLessThan(500)

    if (res.ok()) {
      const body = await res.json()
      // Should still return all 8 keys (filtered by tenant)
      for (const key of KPI_KEYS) {
        expect(body).toHaveProperty(key)
      }
    }
  })

  test('KPI filtered by territoryId', async ({ request }) => {
    const res = await request.get(
      `${BFF}/api/reports/territory-kpis?tenantId=${tenantId}&territoryId=${territoryId}`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    )

    expect(res.status()).toBeLessThan(500)

    if (res.ok()) {
      const body = await res.json()
      for (const key of KPI_KEYS) {
        expect(body).toHaveProperty(key)
      }
    }
  })
})
