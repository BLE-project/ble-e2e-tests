import { test, expect } from '@playwright/test'
import { ApiClient } from '../../helpers/api-client'

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

  test('GET /api/v1/tenants reaches core-registry (200)', async () => {
    const response = await adminClient.get('/api/v1/tenants')
    expect(response.status()).toBe(200)
    const body = await response.json()
    // Should return an array or object with tenant data
    expect(body).toBeDefined()
  })

  test('GET /api/v1/users reaches identity-access (200)', async () => {
    // identity-access requires a tenant context header
    const response = await tenantClient.get('/api/v1/users', {
      'X-Tenant-Id': 'default',
    })
    // 200 OK or 403 (if the tenant header value is wrong but the route is reachable)
    expect([200, 403]).toContain(response.status())
  })

  test('GET /api/v1/events reaches event-ingestion', async () => {
    const response = await adminClient.get('/api/v1/events')
    // Reachable means we get a valid HTTP status (not 502/503/504)
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /api/v1/beacon-groups reaches notification-service', async () => {
    const response = await tenantClient.get('/api/v1/beacon-groups')
    // Reachable: should not be a gateway error
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /api/v1/badges/{tenantId} reaches gamification', async () => {
    const response = await adminClient.get('/api/v1/badges/default')
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
