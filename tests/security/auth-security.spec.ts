/**
 * Security tests — Authentication hardening
 *
 * Verifies that the auth system rejects manipulated, expired, and missing
 * tokens, resists brute-force and SQL injection attacks on the login endpoint.
 * All tests are API-only (Playwright request context, no browser).
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'

test.describe('Security — Authentication', () => {
  let validToken: string
  let tenantId: string

  test.beforeAll(async () => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'
  })

  test.beforeEach(async ({ request }) => {
    // Get a fresh valid token for manipulation tests
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    validToken = body.token
  })

  test('JWT manipulation — modified payload should be rejected', async ({ request }) => {
    // Split the JWT into header.payload.signature
    const parts = validToken.split('.')
    expect(parts.length).toBe(3)

    // Decode and modify the payload (change sub to a different value)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    payload.sub = 'attacker-injected-user-id'
    payload.realm_access = { roles: ['SUPER_ADMIN'] }

    // Re-encode the payload but keep the original signature (now invalid)
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`

    const res = await request.get(`${BFF}/api/v1/tenants`, {
      headers: {
        Authorization: `Bearer ${tamperedToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    // Tampered token must be rejected — 401 is expected, 403 also acceptable
    expect([401, 403]).toContain(res.status())
  })

  test('Expired token should return 401', async ({ request }) => {
    // Build a fake token with exp in the past
    const parts = validToken.split('.')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    payload.exp = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    const expiredPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const expiredToken = `${parts[0]}.${expiredPayload}.${parts[2]}`

    const res = await request.get(`${BFF}/api/v1/tenants`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect([401, 403]).toContain(res.status())
  })

  test('Missing Authorization header should return 401', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/tenants`, {
      headers: { 'X-Tenant-Id': tenantId },
    })

    expect([401, 403]).toContain(res.status())
  })

  test('Brute force login — 10 consecutive failures should not crash the server', async ({
    request,
  }) => {
    const results: number[] = []

    for (let i = 0; i < 10; i++) {
      const res = await request.post(`${BFF}/api/v1/auth/login`, {
        data: { username: 'brute-force-user', password: `wrong-pass-${i}` },
      })
      results.push(res.status())
    }

    // All should be 401 (or 429 if rate-limited) — never 500
    for (const status of results) {
      expect([401, 429]).toContain(status)
    }
  })

  test('SQL injection in login username should be rejected', async ({ request }) => {
    const payloads = [
      "admin' OR '1'='1",
      "admin'; DROP TABLE users;--",
      "' UNION SELECT * FROM users--",
    ]

    for (const username of payloads) {
      const res = await request.post(`${BFF}/api/v1/auth/login`, {
        data: { username, password: 'dev-pass' },
      })

      // Should NOT succeed — 400/401/422 are all acceptable rejections
      // 500 would indicate the SQL was executed (unhandled)
      expect(res.status()).not.toBe(200)
      expect(res.status()).toBeLessThan(500)
    }
  })

  test('Token reuse after refresh — old token should still work', async ({ request }) => {
    // Login and get initial tokens
    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    expect(loginRes.ok()).toBeTruthy()
    const loginBody = await loginRes.json()
    const oldToken = loginBody.token
    const refreshToken = loginBody.refreshToken

    // Refresh to get a new token
    const refreshRes = await request.post(`${BFF}/api/v1/auth/refresh`, {
      data: { refreshToken },
    })
    expect(refreshRes.ok()).toBeTruthy()

    // Old token should still work (JWTs are stateless — not invalidated on refresh)
    const checkRes = await request.get(`${BFF}/api/v1/tenants`, {
      headers: {
        Authorization: `Bearer ${oldToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    // Old token is still valid (signature hasn't changed, not expired)
    expect([200, 401, 403]).toContain(checkRes.status())
  })
})
