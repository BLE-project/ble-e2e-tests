/**
 * k6 Load Test — BLE Platform Baseline
 *
 * Tests core API endpoints under increasing load to establish performance baselines.
 * Thresholds: p95 < 500ms, error rate < 1%
 *
 * Usage:
 *   k6 run load-tests/baseline.js
 *   k6 run --env BFF_URL=http://staging:8080 load-tests/baseline.js
 *
 * Prerequisites:
 *   - Docker stack running (docker compose up)
 *   - k6 installed (https://k6.io/docs/get-started/installation/)
 */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// Custom metrics
const loginDuration = new Trend('login_duration', true)
const tenantListDuration = new Trend('tenant_list_duration', true)
const errorRate = new Rate('errors')

export const options = {
  stages: [
    { duration: '15s', target: 5 },   // warm up
    { duration: '30s', target: 20 },   // ramp to 20 VUs
    { duration: '1m', target: 50 },    // sustain 50 VUs
    { duration: '15s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.05'],
  },
}

const BFF = __ENV.BFF_URL || 'http://localhost:8080'

export function setup() {
  // Login once to get a token for authenticated endpoints
  const res = http.post(
    `${BFF}/api/v1/auth/login`,
    JSON.stringify({ username: 'dev-super-admin', password: 'dev-pass' }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  check(res, { 'login OK': (r) => r.status === 200 })
  const body = res.json()
  return {
    token: body.token,
    tenantId: body.tenantId || '00000000-0000-0000-0000-000000000001',
  }
}

export default function (data) {
  const authHeaders = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': data.tenantId,
  }

  group('health', () => {
    const res = http.get(`${BFF}/gateway/health`)
    check(res, { 'health 200': (r) => r.status === 200 }) || errorRate.add(1)
  })

  group('tenant list', () => {
    const res = http.get(`${BFF}/api/v1/tenants`, { headers: authHeaders })
    tenantListDuration.add(res.timings.duration)
    check(res, {
      'tenants 200': (r) => r.status === 200,
      'tenants is array': (r) => Array.isArray(r.json()),
    }) || errorRate.add(1)
  })

  group('login', () => {
    const res = http.post(
      `${BFF}/api/v1/auth/login`,
      JSON.stringify({ username: 'dev-super-admin', password: 'dev-pass' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
    loginDuration.add(res.timings.duration)
    check(res, {
      'login 200': (r) => r.status === 200,
      'has token': (r) => r.json('token') !== undefined,
    }) || errorRate.add(1)
  })

  sleep(0.5 + Math.random())
}
