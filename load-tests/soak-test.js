/**
 * k6 Soak Test — BLE Platform
 *
 * Long-running test at moderate load: 20 VUs for 5 minutes.
 * Detects memory leaks, connection pool exhaustion, and gradual degradation.
 *
 * Thresholds: p95 < 500ms, error rate < 1%
 *
 * Usage:
 *   k6 run load-tests/soak-test.js
 *   k6 run --env BFF_URL=http://staging:8080 load-tests/soak-test.js
 */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const loginDuration = new Trend('login_duration', true)
const tenantListDuration = new Trend('tenant_list_duration', true)
const errorRate = new Rate('errors')

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up
    { duration: '5m', target: 20 },    // sustained load
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

const BFF = __ENV.BFF_URL || 'http://localhost:8080'

export function setup() {
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

  group('stores', () => {
    const res = http.get(`${BFF}/api/v1/stores`, { headers: authHeaders })
    check(res, { 'stores < 500': (r) => r.status < 500 }) || errorRate.add(1)
  })

  group('badges', () => {
    const res = http.get(`${BFF}/api/v1/badges/${data.tenantId}`, { headers: authHeaders })
    check(res, { 'badges < 500': (r) => r.status < 500 }) || errorRate.add(1)
  })

  sleep(0.5 + Math.random())
}
