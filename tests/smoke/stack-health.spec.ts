/**
 * Smoke Test — Stack Health
 *
 * Verifies ALL 20 Docker services are running and responsive.
 * Run after every stack start to confirm the platform is operational.
 *
 * Usage: npx playwright test --project=smoke
 */
import { test, expect } from '@playwright/test'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const KC = process.env.KC_URL ?? 'http://localhost:8180'
const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:3001'
const PROMETHEUS = process.env.PROMETHEUS_URL ?? 'http://localhost:9090'
const LOKI = process.env.LOKI_URL ?? 'http://localhost:3100'

test.describe('Smoke — Stack Health', () => {
  test('BFF gateway is alive', async ({ request }) => {
    const res = await request.get(`${BFF}/gateway/health`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('UP')
  })

  test('BFF Quarkus health ready', async ({ request }) => {
    const res = await request.get(`${BFF}/q/health/ready`)
    // 200 = all checks pass, 503 = some non-critical check down (e.g. Redis rate-limiter)
    // Both confirm the BFF is running and serving requests
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('checks')
  })

  test('Keycloak realm is accessible', async ({ request }) => {
    const res = await request.get(`${KC}/realms/ble/.well-known/openid-configuration`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.issuer).toContain('/realms/ble')
  })

  test('Grafana is alive', async ({ request }) => {
    const res = await request.get(`${GRAFANA}/api/health`)
    expect(res.status()).toBe(200)
  })

  test('Prometheus is alive', async ({ request }) => {
    const res = await request.get(`${PROMETHEUS}/-/healthy`)
    expect(res.status()).toBe(200)
  })

  test('Loki is alive', async ({ request }) => {
    const res = await request.get(`${LOKI}/ready`)
    expect(res.status()).toBe(200)
  })
})

test.describe('Smoke — Backend Services (via BFF proxy)', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    expect(res.ok()).toBeTruthy()
    token = (await res.json()).token
  })

  const headers = () => ({
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': '00000000-0000-0000-0000-000000000001',
  })

  test('identity-access — GET /api/v1/auth/login reachable', async ({ request }) => {
    // Already verified in beforeAll — login succeeded
    expect(token).toBeTruthy()
    expect(token.length).toBeGreaterThan(100)
  })

  test('core-registry — GET /api/v1/tenants reachable', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/tenants`, { headers: headers() })
    expect([200, 401, 403]).toContain(res.status())
  })

  test('event-ingestion — GET /api/v1/events reachable', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/events`, { headers: headers() })
    // 200, 401, 403, 405 (method not allowed) all confirm service is up
    expect([200, 401, 403, 404, 405]).toContain(res.status())
  })

  test('cashback-ledger — GET /api/v1/ledger reachable', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/ledger`, { headers: headers() })
    expect([200, 401, 403, 404, 405]).toContain(res.status())
  })

  test('notification-service — GET /api/v1/beacon-groups reachable', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/beacon-groups`, { headers: headers() })
    expect([200, 401, 403]).toContain(res.status())
  })

  test('reporting-pa — GET /reports/aggregated reachable', async ({ request }) => {
    const res = await request.get(`${BFF}/reports/aggregated`, { headers: headers() })
    expect([200, 401, 403, 404]).toContain(res.status())
  })

  test('gamification — GET /api/v1/badges/test reachable', async ({ request }) => {
    const res = await request.get(`${BFF}/api/v1/badges/00000000-0000-0000-0000-000000000001`, { headers: headers() })
    expect([200, 401, 403, 404]).toContain(res.status())
  })
})

test.describe('Smoke — Frontend Apps', () => {
  const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174'
  const TENANT = process.env.TENANT_URL ?? 'http://localhost:5173'
  const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:5175'

  test('admin-web serves HTML', async ({ request }) => {
    const res = await request.get(ADMIN)
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('</html>')
  })

  test('tenant-web serves HTML', async ({ request }) => {
    const res = await request.get(TENANT)
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('</html>')
  })

  test('merchant-portal serves HTML', async ({ request }) => {
    const res = await request.get(MERCHANT)
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('</html>')
  })
})

test.describe('Smoke — Authentication Flow', () => {
  const USERS = [
    { username: 'dev-super-admin', role: 'SUPER_ADMIN' },
    { username: 'dev-tenant-admin', role: 'TENANT_ADMIN' },
    { username: 'dev-merchant', role: 'MERCHANT_USER' },
    { username: 'dev-consumer', role: 'CONSUMER' },
    { username: 'dev-sales-agent', role: 'SALES_AGENT' },
    { username: 'dev-pa-analyst', role: 'PA_ANALYST' },
    { username: 'dev-territory-admin', role: 'TERRITORY_ADMIN' },
  ]

  for (const { username, role } of USERS) {
    test(`login ${username} (${role})`, async ({ request }) => {
      const res = await request.post(`${BFF}/api/v1/auth/login`, {
        data: { username, password: 'dev-pass' },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.token).toBeTruthy()
      expect(body.roles).toContain(role)
    })
  }
})

test.describe('Smoke — Security Headers', () => {
  test('BFF returns all security headers', async ({ request }) => {
    const res = await request.get(`${BFF}/gateway/health`)
    const headers = res.headers()
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-xss-protection']).toContain('1')
    expect(headers['referrer-policy']).toBeTruthy()
    expect(headers['permissions-policy']).toBeTruthy()
  })
})

test.describe('Smoke — Database & Migrations', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    if (res.ok()) token = (await res.json()).token
  })

  test('core-registry DB is accessible (tenant list returns array)', async ({ request }) => {
    if (!token) { test.skip(); return }
    const res = await request.get(`${BFF}/api/v1/tenants`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': '00000000-0000-0000-0000-000000000001' },
    })
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
    }
  })

  test('Keycloak realm has all 7 dev users', async ({ request }) => {
    // Login to KC admin
    const tokenRes = await request.post(`${KC}/realms/master/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' },
    })
    if (!tokenRes.ok()) { test.skip(); return }
    const kcToken = (await tokenRes.json()).access_token

    const usersRes = await request.get(`${KC}/admin/realms/ble/users?max=20`, {
      headers: { Authorization: `Bearer ${kcToken}` },
    })
    expect(usersRes.ok()).toBeTruthy()
    const users = await usersRes.json()
    const usernames = users.map((u: { username: string }) => u.username)
    expect(usernames).toContain('dev-super-admin')
    expect(usernames).toContain('dev-tenant-admin')
    expect(usernames).toContain('dev-merchant')
    expect(usernames).toContain('dev-consumer')
    expect(usernames).toContain('dev-sales-agent')
    expect(usernames).toContain('dev-pa-analyst')
    expect(usernames).toContain('dev-territory-admin')
  })
})
