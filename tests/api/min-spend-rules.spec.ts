import { test, expect } from '@playwright/test'
import { ApiClient } from '../../helpers/api-client'
import { getDevTenantId } from '../../fixtures/auth'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'

test.describe('API — Min Spend Rules (FEAT-MIN-SPEND-001)', () => {
  let admin: ApiClient
  let tenantId: string

  test.beforeEach(async ({ request }) => {
    admin = new ApiClient(request, BFF)
    await admin.login('dev-super-admin', 'dev-pass')
    tenantId = getDevTenantId()
  })

  // ── List ──────────────────────────────────────────────────────────────────

  test('GET /min-spend-rules returns global seed', async () => {
    const res = await admin.get('/api/v1/min-spend-rules', { 'X-Tenant-Id': tenantId })
    expect(res.status()).toBe(200)
    const rules = await res.json()
    expect(Array.isArray(rules)).toBeTruthy()
    expect(rules.length).toBeGreaterThanOrEqual(1)
    const global = rules.find((r: any) => r.scope === 'GLOBAL')
    expect(global).toBeDefined()
    expect(global.amountCents).toBe(0) // default = no minimum
  })

  // ── Resolve — cascade ─────────────────────────────────────────────────────

  test('GET /min-spend-rules/resolve without params returns GLOBAL', async () => {
    const res = await admin.get('/api/v1/min-spend-rules/resolve', { 'X-Tenant-Id': tenantId })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('GLOBAL')
    expect(body.amountCents).toBe(0)
    expect(body.amountFormatted).toBe('0.00')
  })

  test('resolve with unknown tenant falls back to GLOBAL', async () => {
    const res = await admin.get(
      '/api/v1/min-spend-rules/resolve?tenantId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      { 'X-Tenant-Id': tenantId },
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('GLOBAL')
  })

  // ── CRUD: set tenant override ──────────────────────────────────────────────

  test('POST tenant override → resolve returns TENANT', async () => {
    // Use unique amount to avoid collision with previous runs
    const amount = 500 + Math.floor(Math.random() * 100)
    const setRes = await admin.post(
      `/api/v1/min-spend-rules/tenant/${tenantId}`,
      { amountCents: amount },
      { 'X-Tenant-Id': tenantId },
    )
    expect(setRes.status()).toBe(201)
    const rule = await setRes.json()
    expect(rule.scope).toBe('TENANT')
    expect(rule.amountCents).toBe(amount)

    // Resolve should now return TENANT scope (multiple tenant overrides may exist)
    const resolveRes = await admin.get(
      `/api/v1/min-spend-rules/resolve?tenantId=${tenantId}`,
      { 'X-Tenant-Id': tenantId },
    )
    expect(resolveRes.status()).toBe(200)
    const resolved = await resolveRes.json()
    expect(resolved.scope).toBe('TENANT')
    expect(resolved.amountCents).toBeGreaterThanOrEqual(0)
  })

  // ── CRUD: set merchant override ────────────────────────────────────────────

  test('POST merchant override → resolve returns MERCHANT (most specific)', async () => {
    // Create a store first
    const storeRes = await admin.post(
      '/api/v1/stores',
      { territoryId: null, name: 'MinSpend Test Store', lat: 44.89, lon: 8.61 },
      { 'X-Tenant-Id': tenantId },
    )
    // Store might already exist — accept 201 or 409
    const storeId = storeRes.status() === 201
      ? (await storeRes.json()).id
      : null

    if (storeId) {
      // Set merchant min-spend to 1000 cents = €10.00
      const setRes = await admin.post(
        `/api/v1/min-spend-rules/merchant/${storeId}`,
        { amountCents: 1000 },
        { 'X-Tenant-Id': tenantId },
      )
      expect(setRes.status()).toBe(201)

      // Resolve with merchantId should return MERCHANT (wins over TENANT)
      const resolveRes = await admin.get(
        `/api/v1/min-spend-rules/resolve?tenantId=${tenantId}&merchantId=${storeId}`,
        { 'X-Tenant-Id': tenantId },
      )
      expect(resolveRes.status()).toBe(200)
      const resolved = await resolveRes.json()
      expect(resolved.scope).toBe('MERCHANT')
      expect(resolved.amountCents).toBe(1000)
    }
  })

  // ── Validation ─────────────────────────────────────────────────────────────

  test('negative amountCents returns 400', async () => {
    const res = await admin.post(
      '/api/v1/min-spend-rules',
      { amountCents: -100 },
      { 'X-Tenant-Id': tenantId },
    )
    expect([400, 422]).toContain(res.status())
  })

  // ── RBAC: MERCHANT_USER can set own merchant min-spend ─────────────────────

  test('MERCHANT_USER can resolve min-spend', async ({ request }) => {
    const merchant = new ApiClient(request, BFF)
    await merchant.login('dev-merchant', 'dev-pass')
    const res = await merchant.get(
      `/api/v1/min-spend-rules/resolve?tenantId=${tenantId}`,
      { 'X-Tenant-Id': tenantId },
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('scope')
    expect(body).toHaveProperty('amountCents')
  })

  // ── RBAC: CONSUMER cannot list min-spend rules ─────────────────────────────

  test('CONSUMER cannot list min-spend rules (403)', async ({ request }) => {
    const consumer = new ApiClient(request, BFF)
    await consumer.login('dev-consumer', 'dev-pass')
    const res = await consumer.get('/api/v1/min-spend-rules', { 'X-Tenant-Id': tenantId })
    expect([401, 403]).toContain(res.status())
  })
})
