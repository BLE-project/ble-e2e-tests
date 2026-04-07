/**
 * k6 Load Test — Beacon Event Endpoint
 *
 * FEAT-S42-007: Tests the beacon event BFF endpoint under sustained load.
 * Simulates 50 VUs sending beacon events in parallel, targeting 100 req/s.
 *
 * Endpoint: POST /bff/v1/consumer/beacon-event
 * Also tests: GET /v1/sdk/beacon-lookup (SDK notification lookup)
 *
 * Usage:
 *   k6 run load-tests/beacon-load.js
 *   k6 run --env BFF_URL=http://staging:8080 load-tests/beacon-load.js
 *
 * Prerequisites:
 *   - Docker stack running (docker compose up)
 *   - k6 installed (https://k6.io/docs/get-started/installation/)
 */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// Custom metrics
const beaconEventDuration = new Trend('beacon_event_duration', true)
const sdkLookupDuration = new Trend('sdk_lookup_duration', true)
const beaconEventErrors = new Rate('beacon_event_errors')
const sdkLookupErrors = new Rate('sdk_lookup_errors')
const totalBeaconEvents = new Counter('total_beacon_events')

export const options = {
  scenarios: {
    // Scenario 1: Sustained beacon events at 50 VUs
    beacon_events: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },   // warm up
        { duration: '20s', target: 30 },   // ramp to 30 VUs
        { duration: '1m',  target: 50 },   // sustain 50 VUs
        { duration: '30s', target: 50 },   // hold steady
        { duration: '10s', target: 0 },    // ramp down
      ],
      exec: 'beaconEventFlow',
    },
    // Scenario 2: SDK lookup under load
    sdk_lookups: {
      executor: 'constant-arrival-rate',
      rate: 100,           // 100 iterations per second
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'sdkLookupFlow',
      startTime: '15s',   // start after beacon events warm up
    },
  },
  thresholds: {
    beacon_event_duration: ['p(95)<500', 'p(99)<1500'],
    sdk_lookup_duration: ['p(95)<300', 'p(99)<1000'],
    beacon_event_errors: ['rate<0.05'],   // < 5% error rate
    sdk_lookup_errors: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
}

const BFF = __ENV.BFF_URL || 'http://localhost:8080'
const SDK_API_KEY = __ENV.SDK_API_KEY || 'test-sdk-key'

// Beacon UUIDs to simulate (varied to avoid caching advantages)
const BEACON_UUIDS = [
  'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
  'E2E-BCN-LOAD-0001-000000000001',
  'E2E-BCN-LOAD-0002-000000000002',
  'E2E-BCN-LOAD-0003-000000000003',
  'E2E-BCN-LOAD-0004-000000000004',
]

const MAJORS = [10011, 200, 300, 400, 500]
const MINORS = [19641, 1001, 1002, 1003, 1004]

export function setup() {
  // Login as consumer to get a token for beacon events
  const consumerLogin = http.post(
    `${BFF}/api/v1/auth/login`,
    JSON.stringify({ username: 'dev-consumer', password: 'dev-pass' }),
    { headers: { 'Content-Type': 'application/json' } },
  )

  let consumerToken = ''
  if (consumerLogin.status === 200) {
    consumerToken = consumerLogin.json('token') || ''
  }

  // Login as tenant admin for fallback
  const adminLogin = http.post(
    `${BFF}/api/v1/auth/login`,
    JSON.stringify({ username: 'dev-super-admin', password: 'dev-pass' }),
    { headers: { 'Content-Type': 'application/json' } },
  )

  let adminToken = ''
  let tenantId = ''
  if (adminLogin.status === 200) {
    const body = adminLogin.json()
    adminToken = body.token || ''
    tenantId = body.tenantId || '00000000-0000-0000-0000-000000000001'
  }

  return {
    consumerToken,
    adminToken,
    tenantId,
  }
}

/**
 * Beacon Event Flow — simulates a consumer's phone detecting beacons
 * and sending events to the BFF.
 */
export function beaconEventFlow(data) {
  const idx = Math.floor(Math.random() * BEACON_UUIDS.length)

  group('beacon-event', () => {
    const payload = JSON.stringify({
      uuid: BEACON_UUIDS[idx],  // Use "uuid" alias (mobile scanner format)
      major: MAJORS[idx],
      minor: MINORS[idx],
      rssi: -40 - Math.floor(Math.random() * 40),  // Random RSSI -40 to -80
    })

    const headers = {
      'Content-Type': 'application/json',
    }

    // Add auth if we have a consumer token
    if (data.consumerToken) {
      headers['Authorization'] = `Bearer ${data.consumerToken}`
    }

    const res = http.post(`${BFF}/bff/v1/consumer/beacon-event`, payload, {
      headers,
      tags: { name: 'beacon-event' },
    })

    beaconEventDuration.add(res.timings.duration)
    totalBeaconEvents.add(1)

    const success = check(res, {
      'beacon event status is 200 or 401': (r) => r.status === 200 || r.status === 401,
      'beacon event response time < 500ms': (r) => r.timings.duration < 500,
      'beacon event no server error': (r) => r.status < 500,
    })

    beaconEventErrors.add(!success)
  })

  sleep(0.1 + Math.random() * 0.2)  // 100-300ms between events
}

/**
 * SDK Lookup Flow — simulates the SDK querying for active beacon messages.
 */
export function sdkLookupFlow(data) {
  const idx = Math.floor(Math.random() * BEACON_UUIDS.length)
  const deviceId = `load-test-device-${idx}`

  group('sdk-lookup', () => {
    const res = http.get(
      `${BFF}/api/v1/sdk/beacon-lookup?deviceId=${deviceId}&tenantId=${data.tenantId}`,
      {
        headers: {
          'X-Api-Key': SDK_API_KEY,
          'Content-Type': 'application/json',
        },
        tags: { name: 'sdk-beacon-lookup' },
      },
    )

    sdkLookupDuration.add(res.timings.duration)

    const success = check(res, {
      'sdk lookup status is 200 or 404': (r) => r.status === 200 || r.status === 404,
      'sdk lookup response time < 300ms': (r) => r.timings.duration < 300,
      'sdk lookup no server error': (r) => r.status < 500,
    })

    sdkLookupErrors.add(!success)
  })
}

export function handleSummary(data) {
  const totalEvents = data.metrics.total_beacon_events
    ? data.metrics.total_beacon_events.values.count
    : 0

  return {
    stdout: `
=== Beacon Load Test Summary ===
Total beacon events sent: ${totalEvents}
Beacon event p95 latency: ${data.metrics.beacon_event_duration?.values?.['p(95)']?.toFixed(0) || 'N/A'}ms
SDK lookup p95 latency:   ${data.metrics.sdk_lookup_duration?.values?.['p(95)']?.toFixed(0) || 'N/A'}ms
Beacon event error rate:  ${((data.metrics.beacon_event_errors?.values?.rate || 0) * 100).toFixed(1)}%
SDK lookup error rate:    ${((data.metrics.sdk_lookup_errors?.values?.rate || 0) * 100).toFixed(1)}%
================================
`,
  }
}
