import { test, expect } from '@playwright/test'

/**
 * T-162 L3 — Playwright API tests for the Grafana beacon-health alert webhook.
 *
 * Targets: GET/POST /v1/alerts/beacon-health on notification-service.
 *
 * The endpoint is a Bearer-token-authenticated Grafana contact-point receiver.
 * It accepts Grafana alert payloads, deduplications firing alerts, and dispatches
 * push notifications to sales agents in the beacon's territory.
 *
 * Preconditions:
 *   - notification-service up on http://localhost:8084  (or $NOTIF_URL)
 *   - BLE_ALERT_WEBHOOK_TOKEN = 'dev-alert-secret' (default dev config)
 */

const NOTIF_URL      = process.env.NOTIF_URL           ?? 'http://localhost:8084'
const WEBHOOK_TOKEN  = process.env.BLE_ALERT_WEBHOOK_TOKEN ?? 'dev-alert-secret'
const ALERT_ENDPOINT = `${NOTIF_URL}/v1/alerts/beacon-health`

// ── Auth tests ───────────────────────────────────────────────────────────────

test.describe('T-162 — beacon-health-alert auth', () => {
  test('missing Authorization header returns 401', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ alerts: [] }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_INVALID')
  })

  test('wrong Bearer token returns 401', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer totally-wrong-secret',
      },
      body: JSON.stringify({ alerts: [] }),
    })
    expect(res.status).toBe(401)
  })

  test('non-Bearer Authorization scheme returns 401', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${btoa('admin:admin')}`,
      },
      body: JSON.stringify({ alerts: [] }),
    })
    expect(res.status).toBe(401)
  })
})

// ── Payload validation tests ─────────────────────────────────────────────────

test.describe('T-162 — beacon-health-alert payload validation', () => {
  test('empty alerts[] returns 200 with dispatched=0', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({ alerts: [] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dispatched: number; skipped: number }
    expect(body.dispatched).toBe(0)
    expect(body.skipped).toBe(0)
  })

  test('missing alerts[] field returns 400 MALFORMED', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({ notAlerts: [] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('MALFORMED')
  })

  test('malformed JSON returns 400', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: '{not valid json',
    })
    expect(res.status).toBe(400)
  })
})

// ── Dispatch tests ───────────────────────────────────────────────────────────

test.describe('T-162 — beacon-health-alert dispatch', () => {
  test('resolved alert (status=resolved) is skipped — dispatched=0', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({
        alerts: [{
          status: 'resolved',
          labels: {
            alertname:    'ble-beacon-silent-30m',
            severity:     'warning',
            component:    'ble-beacon',
            beacon_uuid:  'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
            territory_id: 'e2e-territory-id',
          },
          annotations: { summary: 'Resolved beacon alert (e2e)' },
        }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dispatched: number }
    expect(body.dispatched).toBe(0)    // resolved alerts are informational only
  })

  test('non-ble-beacon component is skipped — dispatched=0', async () => {
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({
        alerts: [{
          status: 'firing',
          labels: {
            alertname: 'some-other-alert',
            severity:  'critical',
            component: 'database',           // not a ble-beacon component
          },
          annotations: { summary: 'DB alert' },
        }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dispatched: number }
    expect(body.dispatched).toBe(0)
  })

  test('firing ble-beacon alert responds 200 with dispatched field', async () => {
    const beaconUuid = `FDA50693-A4E2-4FB1-AFCF-C6EB07647825`
    const res = await fetch(ALERT_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({
        alerts: [{
          status: 'firing',
          labels: {
            alertname:    'ble-beacon-silent-30m',
            severity:     'warning',
            component:    'ble-beacon',
            beacon_uuid:  beaconUuid,
            major:        '1',
            minor:        '101',
            territory_id: 'e2e-territory-id',
          },
          annotations: { summary: `Beacon ${beaconUuid} silent 30m (e2e)` },
        }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      dispatched: number
      skipped:    number
      fingerprints: string[]
    }
    // dispatched ≥ 0 (0 when no sales agents registered for that territory in test env)
    expect(body.dispatched).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(body.fingerprints)).toBe(true)
  })

  test('duplicate firing alert within dedup window is skipped', async () => {
    const beaconUuid = `BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBB${Date.now().toString().slice(-5)}`
    const payload = JSON.stringify({
      alerts: [{
        status: 'firing',
        labels: {
          alertname:    'ble-beacon-silent-30m',
          severity:     'warning',
          component:    'ble-beacon',
          beacon_uuid:  beaconUuid,
          major:        '2',
          minor:        '202',
          territory_id: 'e2e-territory-dedup',
        },
        annotations: { summary: `Dedup test beacon ${beaconUuid}` },
      }],
    })
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${WEBHOOK_TOKEN}`,
    }

    // First call — should dispatch (or skip if territory has no agents)
    const first = await fetch(ALERT_ENDPOINT, { method: 'POST', headers, body: payload })
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { dispatched: number; skipped: number }
    const firstTotal = firstBody.dispatched + firstBody.skipped

    // Immediate second call — same fingerprint must be deduplicated
    const second = await fetch(ALERT_ENDPOINT, { method: 'POST', headers, body: payload })
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { dispatched: number; skipped: number }
    expect(secondBody.skipped).toBe(1)
    expect(secondBody.dispatched).toBe(0)
  })
})
