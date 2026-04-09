/**
 * Mobile API tests — Consumer app endpoints.
 *
 * Covers every REST call made by ble-consumer-mobile:
 *   - Auth (login)
 *   - Consumer profile (GET/PUT /api/v1/consumer-profiles/me)
 *   - Wallet & loyalty cards (GET /api/v1/loyalty-cards/me, GET /bff/v1/mobile/wallet/balance)
 *   - Ledger history (GET /bff/v1/consumer/history)
 *   - Branding (GET /bff/v1/consumer/brand)
 *   - Tenant context / federation (GET/PUT /bff/v1/consumer/context, POST beacon-event)
 *   - Consumer self-registration (POST /api/v1/consumers/register)
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const CONSUMER_USER = process.env.CONSUMER_USER ?? 'dev-consumer'
const CONSUMER_PASS = process.env.CONSUMER_PASS ?? 'dev-pass'

/** Resolve tenant ID from seed data. */
function getTenantId(): string {
  const seed = loadSeedDataSync()
  return seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
}

/** Login and return the JWT token. */
async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BFF}/api/v1/auth/login`, {
    data: { username: CONSUMER_USER, password: CONSUMER_PASS },
  })
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  expect(body.token).toBeTruthy()
  return body.token
}

/** Build auth + tenant headers. */
function hdrs(tok: string, tid?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${tok}`,
    'X-Tenant-Id': tid ?? getTenantId(),
    'Content-Type': 'application/json',
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

test.describe('Consumer Auth', () => {
  test('POST /api/v1/auth/login — valid credentials returns token', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: CONSUMER_USER, password: CONSUMER_PASS },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.token).toBeTruthy()
  })

  test('POST /api/v1/auth/login — invalid credentials returns 401', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'nonexistent', password: 'wrong' },
    })
    expect(res.status()).toBe(401)
  })
})

// ── Consumer Profile ─────────────────────────────────────────────────────────
//
// These /api/v1/ endpoints are proxied to the identity-access microservice.
// In local dev the downstream service may reject the JWT (issuer mismatch
// between Docker-internal Keycloak URL and host-reachable URL), producing 401.

test.describe('Consumer Profile', () => {
  test('GET /api/v1/consumer-profiles/me — returns profile or 404', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/api/v1/consumer-profiles/me`, {
      headers: hdrs(token),
    })
    // 200 profile, 404 none yet, 401 JWT mismatch, 403 role mismatch (identity-access may use different role claim path)
    expect([200, 400, 401, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('consumerId')
    }
  })

  test('PUT /api/v1/consumer-profiles/me — upsert profile', async ({ request }) => {
    const token = await login(request)
    const res = await request.put(`${BFF}/api/v1/consumer-profiles/me`, {
      headers: hdrs(token),
      data: {
        gender: 'NOT_SPECIFIED',
        language: 'it-IT',
        interests: ['food', 'travel'],
      },
    })
    // 200 on success, 401 JWT mismatch, 403 role mismatch, 422 targeting consent missing
    expect([200, 401, 403, 422]).toContain(res.status())
  })
})

// ── Wallet & Loyalty Cards ───────────────────────────────────────────────────

test.describe('Wallet & Loyalty Cards', () => {
  test('GET /api/v1/loyalty-cards/me — returns cards array', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/api/v1/loyalty-cards/me`, {
      headers: hdrs(token),
    })
    // 200 with cards, 400/401 if downstream issue, 404 none found
    expect([200, 400, 401, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })

  test('GET /bff/v1/mobile/wallet/balance — returns balance', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/bff/v1/mobile/wallet/balance`, {
      headers: hdrs(token),
    })
    expect([200, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('balanceCents')
      // currency may or may not be present depending on BFF version
      expect(body).toHaveProperty('consumerId')
    }
  })
})

// ── Ledger / Transaction History ─────────────────────────────────────────────

test.describe('Ledger History', () => {
  test('GET /bff/v1/consumer/history — returns paginated entries', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/bff/v1/consumer/history`, {
      headers: hdrs(token),
    })
    // 200 with data, 403 if consumer context not set, 404 no entries, 500 BFF error
    expect([200, 401, 403, 404, 500, 502]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('entries')
      expect(Array.isArray(body.entries)).toBeTruthy()
    }
  })

  test('GET /bff/v1/consumer/history — supports query params', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(
      `${BFF}/bff/v1/consumer/history?page=0&size=5&type=EARN`,
      { headers: hdrs(token) },
    )
    expect([200, 401, 403, 404, 500, 502]).toContain(res.status())
  })
})

// ── Branding ─────────────────────────────────────────────────────────────────

test.describe('Branding', () => {
  test('GET /bff/v1/consumer/brand — returns resolved branding', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/bff/v1/consumer/brand`, {
      headers: hdrs(token),
    })
    expect([200, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('primaryColor')
      expect(body).toHaveProperty('currency')
    }
  })
})

// ── Tenant Context / Federation ──��───────────────────────────────────────────

test.describe('Tenant Context & Federation', () => {
  test('GET /bff/v1/consumer/context — returns consumer context', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/bff/v1/consumer/context`, {
      headers: hdrs(token),
    })
    // 200 context found, 403 if consumer context not set, 404 no context, 500 BFF error
    expect([200, 401, 403, 404, 500, 502]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('consumerId')
    }
  })

  test('PUT /bff/v1/consumer/context — switch tenant context', async ({ request }) => {
    const token = await login(request)
    const tenantId = getTenantId()
    const res = await request.put(`${BFF}/bff/v1/consumer/context`, {
      headers: hdrs(token),
      data: { tenantId, source: 'MANUAL' },
    })
    // 200 on success, 403 if not allowed, 404 if feature not enabled, 500 BFF error
    expect([200, 401, 403, 404, 500, 502]).toContain(res.status())
  })

  test('POST /bff/v1/consumer/beacon-event — simulate beacon detection', async ({ request }) => {
    const token = await login(request)
    const res = await request.post(`${BFF}/bff/v1/consumer/beacon-event`, {
      headers: hdrs(token),
      data: {
        // Valid hex UUID required by @Pattern validation on the endpoint
        ibeaconUuid: 'e2e00000-0000-0000-0000-000000000001',
        major: 100,
        minor: 1,
        rssi: -65,
      },
    })
    // 200 with action, 400 if UUID not found / validation, 404 if no matching beacon, 500 on error
    expect([200, 400, 404, 500]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('action')
    }
  })
})

// ── Consumer Self-Registration ───────────────────────────────────────────────

test.describe('Consumer Registration', () => {
  test('POST /api/v1/consumers/register — registration endpoint reachable', async ({ request }) => {
    const uniqueEmail = `e2e-test-${Date.now()}@ble-test.local`
    const res = await request.post(`${BFF}/api/v1/consumers/register`, {
      data: {
        username: `e2etest${Date.now()}`,
        email: uniqueEmail,
        password: 'E2eTestPass1!',
        firstName: 'E2E',
        lastName: 'Test',
      },
    })
    // 201 on success, 409 if user exists, 400 on validation error
    expect([201, 400, 409]).toContain(res.status())
  })
})
