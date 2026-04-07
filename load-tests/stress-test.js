/**
 * k6 Stress Test — BLE Platform
 *
 * Progressively increases load to find the breaking point:
 * 50 -> 100 -> 200 -> 300 VUs, then ramp down.
 *
 * Thresholds: p95 < 3000ms (relaxed — goal is to find the limit)
 *
 * Usage:
 *   k6 run load-tests/stress-test.js
 *   k6 run --env BFF_URL=http://staging:8080 load-tests/stress-test.js
 */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const loginDuration = new Trend('login_duration', true)
const tenantListDuration = new Trend('tenant_list_duration', true)
const errorRate = new Rate('errors')

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // warm up to 50
    { duration: '30s', target: 100 },  // moderate load
    { duration: '30s', target: 200 },  // heavy load
    { duration: '30s', target: 300 },  // stress / breaking point
    { duration: '1m', target: 0 },     // recovery
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],
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
      'tenants reachable': (r) => r.status < 500,
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
      'login reachable': (r) => r.status < 500,
    }) || errorRate.add(1)
  })

  group('stores', () => {
    const res = http.get(`${BFF}/api/v1/stores`, { headers: authHeaders })
    check(res, { 'stores reachable': (r) => r.status < 500 }) || errorRate.add(1)
  })

  group('events', () => {
    const res = http.get(`${BFF}/api/v1/events`, { headers: authHeaders })
    check(res, { 'events reachable': (r) => r.status < 500 }) || errorRate.add(1)
  })

  group('badges', () => {
    const res = http.get(`${BFF}/api/v1/badges/${data.tenantId}`, { headers: authHeaders })
    check(res, { 'badges reachable': (r) => r.status < 500 }) || errorRate.add(1)
  })

  sleep(0.2 + Math.random() * 0.5)
}
