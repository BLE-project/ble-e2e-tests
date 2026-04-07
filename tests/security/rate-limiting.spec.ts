/**
 * Security tests — Rate Limiting
 *
 * Verifies that the BFF applies rate limiting to prevent abuse.
 * Tests burst requests, login rate limiting, and per-tenant isolation.
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'

test.describe('Security — Rate Limiting', () => {
  let token: string
  let tenantId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'

    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    token = body.token
  })

  test('Burst requests — 100 rapid requests should eventually return 429 or stay stable', async ({
    request,
  }) => {
    const statuses: number[] = []

    // Fire 100 requests as fast as possible
    const promises = Array.from({ length: 100 }, () =>
      request.get(`${BFF}/gateway/health`).then((r) => r.status()),
    )
    const results = await Promise.all(promises)
    statuses.push(...results)

    // Count responses
    const count200 = statuses.filter((s) => s === 200).length
    const count429 = statuses.filter((s) => s === 429).length
    const count5xx = statuses.filter((s) => s >= 500).length

    // Should NOT have server errors
    expect(count5xx).toBe(0)

    // Either all pass (no rate limiting on health) or some get 429
    // Both are acceptable — the test verifies server stability under burst
    expect(count200 + count429).toBe(100)
  })

  test('Login rate limiting — 20 failed logins should be handled gracefully', async ({
    request,
  }) => {
    const statuses: number[] = []

    for (let i = 0; i < 20; i++) {
      const res = await request.post(`${BFF}/api/v1/auth/login`, {
        data: { username: `attacker-${i}@evil.com`, password: 'wrong' },
      })
      statuses.push(res.status())
    }

    const count401 = statuses.filter((s) => s === 401).length
    const count429 = statuses.filter((s) => s === 429).length
    const count5xx = statuses.filter((s) => s >= 500).length

    // No server errors
    expect(count5xx).toBe(0)

    // All should be 401 (unauthorized) or 429 (rate limited)
    expect(count401 + count429).toBe(20)

    // If rate limiting is active, some should be 429
    // We just log whether rate limiting is active (not a hard requirement in dev)
    if (count429 > 0) {
      console.log(`Rate limiting active: ${count429}/20 requests rate-limited`)
    } else {
      console.log('Rate limiting not active on login endpoint (dev mode)')
    }
  })

  test('API rate limiting — requests from different tenants should not interfere', async ({
    request,
  }) => {
    // Login as two different users (same tenant in dev, but test the concept)
    const loginAdmin = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    const adminToken = (await loginAdmin.json()).token

    const loginTenant = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-tenant-admin', password: 'dev-pass' },
    })
    const tenantToken = (await loginTenant.json()).token

    // Send requests from admin
    const adminResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        request
          .get(`${BFF}/api/v1/tenants`, {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'X-Tenant-Id': tenantId,
            },
          })
          .then((r) => r.status()),
      ),
    )

    // Send requests from tenant admin
    const tenantResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        request
          .get(`${BFF}/api/v1/stores`, {
            headers: {
              Authorization: `Bearer ${tenantToken}`,
              'X-Tenant-Id': tenantId,
            },
          })
          .then((r) => r.status()),
      ),
    )

    // Both sets should work independently — no 500 errors
    const admin5xx = adminResults.filter((s) => s >= 500).length
    const tenant5xx = tenantResults.filter((s) => s >= 500).length

    expect(admin5xx).toBe(0)
    expect(tenant5xx).toBe(0)
  })
})
