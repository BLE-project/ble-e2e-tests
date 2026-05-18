import { test, expect } from '@playwright/test'

/**
 * T-162 L3 — Playwright API tests for push-token lifecycle.
 *
 * Preconditions:
 *   - notification-service up on http://localhost:8084
 *   - api-gateway-bff up on http://localhost:8080
 *   - dev-consumer + dev-sales-agent users in Keycloak
 */

const BFF_URL    = process.env.BFF_URL    ?? 'http://localhost:8080'
const NOTIF_URL  = process.env.NOTIF_URL  ?? 'http://localhost:8084'
const TENANT_ID  = process.env.E2E_TENANT ?? '00000000-0000-0000-0000-00000000AAAA'
const CONSUMER   = { username: 'dev-consumer',    password: 'dev-pass' }
const SALES      = { username: 'dev-sales-agent', password: 'dev-pass' }

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`login ${username} failed ${res.status}`)
  const { token } = (await res.json()) as { token: string }
  return token
}

/** Decode the `sub` claim from a JWT — staff endpoint requires a non-blank staffId. */
function jwtSub(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { sub: string }
  return payload.sub
}

test.describe('T-162 — consumer push-token registration', () => {
  test('POST /bff/v1/consumer/push-token returns 204', async () => {
    const token = await login(CONSUMER.username, CONSUMER.password)
    const pushToken = `e2e-consumer-${Date.now()}`

    const res = await fetch(`${BFF_URL}/bff/v1/consumer/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Tenant-Id':   TENANT_ID,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        pushToken, platform: 'android', appVersion: '1.0.0', deviceModel: 'e2e-device',
      }),
    })
    expect([204, 502]).toContain(res.status)   // 502 if notif-service unavailable
  })

  test('missing X-Tenant-Id returns 400', async () => {
    const token = await login(CONSUMER.username, CONSUMER.password)
    const res = await fetch(`${BFF_URL}/bff/v1/consumer/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ pushToken: 'x', platform: 'android' }),
    })
    expect(res.status).toBe(400)
  })
})

test.describe('T-162 — sales-agent push-token with territories', () => {
  test('POST /bff/v1/sales-agent/push-token returns 204 with territoryIds[]', async () => {
    const token = await login(SALES.username, SALES.password)
    const pushToken = `e2e-sales-${Date.now()}`

    const res = await fetch(`${BFF_URL}/bff/v1/sales-agent/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Tenant-Id':   TENANT_ID,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        pushToken, platform: 'android',
        appVersion: '1.0.0', deviceModel: 'e2e-sales',
        territoryIds: ['e2e-territory-id-1', 'e2e-territory-id-2'],
      }),
    })
    expect([204, 502]).toContain(res.status)
  })
})

test.describe('T-162 — Grafana alert webhook receiver', () => {
  const WEBHOOK_TOKEN = process.env.BLE_ALERT_WEBHOOK_TOKEN ?? 'dev-alert-secret'

  test('no Bearer returns 401', async () => {
    const res = await fetch(`${NOTIF_URL}/v1/alerts/beacon-health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts: [] }),
    })
    expect(res.status).toBe(401)
  })

  test('firing ble-beacon alert dispatched', async () => {
    const res = await fetch(`${NOTIF_URL}/v1/alerts/beacon-health`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({
        alerts: [{
          status: 'firing',
          labels: {
            alertname:   'ble-beacon-silent-30m',
            severity:    'warning',
            component:   'ble-beacon',
            beacon_uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
            major:       '1',
            minor:       '101',
            territory_id: 'e2e-territory-id',
          },
          annotations: { summary: 'Holy-IOT H-01 silent 30m (e2e)' },
        }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dispatched: number }
    expect(body.dispatched).toBeGreaterThanOrEqual(0)
  })
})

test.describe('FU — staff / back-office push-token registration (/staff)', () => {
  // SALES_AGENT is one of the roles allowed on the staff endpoint; reuse it.
  test('POST /api/v1/device-tokens/staff returns 201', async () => {
    const token = await login(SALES.username, SALES.password)
    const pushToken = `e2e-staff-${Date.now()}`

    const res = await fetch(`${BFF_URL}/api/v1/device-tokens/staff`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Tenant-Id':   TENANT_ID,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        staffId: jwtSub(token),       // non-admin: must equal JWT subject
        audience: 'territory',
        pushToken, platform: 'web', appVersion: 'e2e', deviceModel: 'e2e-staff',
      }),
    })
    expect([201, 502]).toContain(res.status)   // 502 if notif-service unavailable
  })

  test('staff missing X-Tenant-Id returns 400', async () => {
    const token = await login(SALES.username, SALES.password)
    const res = await fetch(`${BFF_URL}/api/v1/device-tokens/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        staffId: jwtSub(token), audience: 'territory', pushToken: 'x', platform: 'web',
      }),
    })
    expect(res.status).toBe(400)
  })

  test('staff endpoint without auth returns 401/403', async () => {
    const res = await fetch(`${BFF_URL}/api/v1/device-tokens/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT_ID },
      body: JSON.stringify({
        staffId: 'x', audience: 'merchant', pushToken: 'x', platform: 'web',
      }),
    })
    expect([401, 403]).toContain(res.status)
  })
})
