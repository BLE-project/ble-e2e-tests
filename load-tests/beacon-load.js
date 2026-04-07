/**
 * k6 Load Test — Beacon Event Endpoint + Multi-Beacon Duplicate Identity
 *
 * FEAT-S42-007 + FEAT-S44-003: Tests the beacon event BFF endpoint under
 * sustained load, including the S44 scenario where 100 beacon events arrive
 * from different "beacons" sharing the same UUID but with different RSSI
 * (simulating the duplicate identity problem from factory-default Holy-IOTs).
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
const dupIdentityDuration = new Trend('dup_identity_event_duration', true)
const beaconEventErrors = new Rate('beacon_event_errors')
const sdkLookupErrors = new Rate('sdk_lookup_errors')
const dupIdentityErrors = new Rate('dup_identity_errors')
const totalBeaconEvents = new Counter('total_beacon_events')
const totalDupIdentityEvents = new Counter('total_dup_identity_events')

export const options = {
  scenarios: {
    // Scenario 1: Sustained beacon events at 50 VUs
    beacon_events: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '20s', target: 30 },
        { duration: '1m',  target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      exec: 'beaconEventFlow',
    },
    // Scenario 2: SDK lookup under load
    sdk_lookups: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'sdkLookupFlow',
      startTime: '15s',
    },
    // Scenario 3 (S44): Duplicate identity beacon burst
    // Simulates 100 beacon events from "different beacons" that share
    // the same UUID/Major/Minor (factory default Holy-IOT problem)
    dup_identity_burst: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 10,          // 10 VUs x 10 iterations = 100 events
      exec: 'dupIdentityFlow',
      startTime: '5s',
    },
    // Scenario 4 (S44): Sustained duplicate identity under concurrent load
    // Simulates multiple consumers detecting the same duplicated beacon identity
    dup_identity_sustained: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '30s', target: 20 },
        { duration: '20s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      exec: 'dupIdentitySustainedFlow',
      startTime: '30s',
    },
  },
  thresholds: {
    beacon_event_duration: ['p(95)<500', 'p(99)<1500'],
    sdk_lookup_duration: ['p(95)<300', 'p(99)<1000'],
    dup_identity_event_duration: ['p(95)<500', 'p(99)<1500'],
    beacon_event_errors: ['rate<0.05'],
    sdk_lookup_errors: ['rate<0.05'],
    dup_identity_errors: ['rate<0.05'],
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

// S44: The factory-default UUID that all Holy-IOT beacons share
const DUP_UUID  = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825'
const DUP_MAJOR = 10011
const DUP_MINOR = 19641

// S44: Simulated RSSI range for different "physical beacons" with same identity
// Real scan values: -39 (IMMEDIATE), -71 (FAR), -73 (FAR)
const DUP_RSSI_RANGE = { min: -80, max: -30 }

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
      uuid: BEACON_UUIDS[idx],
      major: MAJORS[idx],
      minor: MINORS[idx],
      rssi: -40 - Math.floor(Math.random() * 40),
    })

    const headers = {
      'Content-Type': 'application/json',
    }

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

  sleep(0.1 + Math.random() * 0.2)
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

/**
 * S44: Duplicate Identity Burst Flow — simulates 100 beacon events from
 * different "beacons" (same UUID/Major/Minor, different RSSI).
 *
 * This tests the platform's ability to handle the factory-default
 * configuration problem where multiple Holy-IOT beacons advertise
 * the same iBeacon identity triple.
 */
export function dupIdentityFlow(data) {
  group('dup-identity-burst', () => {
    // Each event has a random RSSI simulating a different physical beacon
    const rssi = DUP_RSSI_RANGE.min + Math.floor(Math.random() * (DUP_RSSI_RANGE.max - DUP_RSSI_RANGE.min))

    const payload = JSON.stringify({
      uuid: DUP_UUID,
      major: DUP_MAJOR,
      minor: DUP_MINOR,
      rssi,
    })

    const headers = { 'Content-Type': 'application/json' }
    if (data.consumerToken) {
      headers['Authorization'] = `Bearer ${data.consumerToken}`
    }

    const res = http.post(`${BFF}/bff/v1/consumer/beacon-event`, payload, {
      headers,
      tags: { name: 'dup-identity-event' },
    })

    dupIdentityDuration.add(res.timings.duration)
    totalDupIdentityEvents.add(1)

    const success = check(res, {
      'dup identity event accepted (200) or auth (401)': (r) => r.status === 200 || r.status === 401,
      'dup identity response time < 500ms': (r) => r.timings.duration < 500,
      'dup identity no server error': (r) => r.status < 500,
    })

    dupIdentityErrors.add(!success)
  })
}

/**
 * S44: Sustained Duplicate Identity Flow — simulates multiple consumers
 * concurrently detecting beacons with the same identity and sending events.
 * Tests the SDK lookup under concurrent duplicate-identity beacon events.
 */
export function dupIdentitySustainedFlow(data) {
  group('dup-identity-sustained', () => {
    // Rotate through the 3 real RSSI values from the S44 scan
    const realRssiValues = [-39, -71, -73]
    const rssi = realRssiValues[Math.floor(Math.random() * realRssiValues.length)]

    const payload = JSON.stringify({
      uuid: DUP_UUID,
      major: DUP_MAJOR,
      minor: DUP_MINOR,
      rssi,
    })

    const headers = { 'Content-Type': 'application/json' }
    if (data.consumerToken) {
      headers['Authorization'] = `Bearer ${data.consumerToken}`
    }

    const res = http.post(`${BFF}/bff/v1/consumer/beacon-event`, payload, {
      headers,
      tags: { name: 'dup-identity-sustained' },
    })

    dupIdentityDuration.add(res.timings.duration)
    totalDupIdentityEvents.add(1)

    const success = check(res, {
      'sustained dup identity no server error': (r) => r.status < 500,
    })

    dupIdentityErrors.add(!success)

    // Also test SDK lookup for the same beacon
    if (data.tenantId) {
      const lookupRes = http.get(
        `${BFF}/api/v1/sdk/beacon-lookup?deviceId=dup-test-${__VU}&tenantId=${data.tenantId}`,
        {
          headers: {
            'X-Api-Key': SDK_API_KEY,
            'Content-Type': 'application/json',
          },
          tags: { name: 'dup-sdk-lookup' },
        },
      )

      sdkLookupDuration.add(lookupRes.timings.duration)

      check(lookupRes, {
        'dup sdk lookup no server error': (r) => r.status < 500,
      })
    }
  })

  sleep(0.05 + Math.random() * 0.1)
}

export function handleSummary(data) {
  const totalEvents = data.metrics.total_beacon_events
    ? data.metrics.total_beacon_events.values.count
    : 0
  const totalDupEvents = data.metrics.total_dup_identity_events
    ? data.metrics.total_dup_identity_events.values.count
    : 0

  return {
    stdout: `
=== Beacon Load Test Summary (S44) ===
Total beacon events sent:       ${totalEvents}
Total dup-identity events sent: ${totalDupEvents}
Beacon event p95 latency:       ${data.metrics.beacon_event_duration?.values?.['p(95)']?.toFixed(0) || 'N/A'}ms
SDK lookup p95 latency:         ${data.metrics.sdk_lookup_duration?.values?.['p(95)']?.toFixed(0) || 'N/A'}ms
Dup identity p95 latency:       ${data.metrics.dup_identity_event_duration?.values?.['p(95)']?.toFixed(0) || 'N/A'}ms
Beacon event error rate:        ${((data.metrics.beacon_event_errors?.values?.rate || 0) * 100).toFixed(1)}%
SDK lookup error rate:          ${((data.metrics.sdk_lookup_errors?.values?.rate || 0) * 100).toFixed(1)}%
Dup identity error rate:        ${((data.metrics.dup_identity_errors?.values?.rate || 0) * 100).toFixed(1)}%
========================================
`,
  }
}
