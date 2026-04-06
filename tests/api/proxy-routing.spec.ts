import { test, expect } from '@playwright/test'
import { ApiClient } from '../../helpers/api-client'
import { DEV_TENANT_ID } from '../../fixtures/auth'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'

test.describe('API - Proxy Routing', () => {
  let adminClient: ApiClient
  let tenantClient: ApiClient

  test.beforeEach(async ({ request }) => {
    adminClient = new ApiClient(request, BFF_URL)
    await adminClient.login(ADMIN_USER, ADMIN_PASS)

    tenantClient = new ApiClient(request, BFF_URL)
    await tenantClient.login(TENANT_USER, TENANT_PASS)
  })

  test('GET /api/v1/tenants reaches core-registry', async () => {
    const response = await adminClient.get('/api/v1/tenants', {
      'X-Tenant-Id': DEV_TENANT_ID,
    })
    // 200 = success, 401 = auth issue but route is reachable (not 502/504)
    expect([200, 401, 403]).toContain(response.status())
  })

  test('GET /api/v1/users reaches identity-access', async () => {
    const response = await tenantClient.get('/api/v1/users', {
      'X-Tenant-Id': DEV_TENANT_ID,
    })
    // 200/401/403 all confirm the proxy forwarded to identity-access (not 502)
    expect([200, 401, 403]).toContain(response.status())
  })

  test('GET /api/v1/events reaches event-ingestion', async () => {
    const response = await adminClient.get('/api/v1/events')
    // Reachable means we get a valid HTTP status (not 502/503/504)
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /api/v1/beacon-groups reaches notification-service', async () => {
    const response = await tenantClient.get('/api/v1/beacon-groups', {
      'X-Tenant-Id': DEV_TENANT_ID,
    })
    // Reachable: should not be a gateway error
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /api/v1/badges/{tenantId} reaches gamification', async () => {
    const response = await adminClient.get(`/api/v1/badges/${DEV_TENANT_ID}`)
    // Reachable
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /reports/aggregated reaches reporting-pa', async () => {
    const response = await adminClient.get('/reports/aggregated')
    // Reachable
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /api/v1/ledger reaches cashback-ledger', async () => {
    const response = await adminClient.get('/api/v1/ledger')
    // Reachable
    expect(response.status()).toBeLessThan(500)
  })
})
