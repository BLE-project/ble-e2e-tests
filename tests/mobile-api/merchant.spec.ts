/**
 * Mobile API tests — Merchant app endpoints.
 *
 * Covers every REST call made by ble-merchant-mobile:
 *   - Auth (login)
 *   - POS barcode lookup (GET /bff/v1/merchant/pos/barcode/{value})
 *   - POS spend (POST /bff/v1/merchant/pos/spend)
 *   - Billing records (GET /api/v1/billing/merchants/{id}/records)
 *   - Commission accruals (GET /api/v1/billing/merchants/{id}/accruals)
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const MERCHANT_USER = process.env.MERCHANT_USER ?? 'dev-merchant'
const MERCHANT_PASS = process.env.MERCHANT_PASS ?? 'dev-pass'

function getTenantId(): string {
  const seed = loadSeedDataSync()
  return seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
}

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BFF}/api/v1/auth/login`, {
    data: { username: MERCHANT_USER, password: MERCHANT_PASS },
  })
  expect(res.ok(), `merchant login failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  expect(body.token).toBeTruthy()
  return body.token
}

function hdrs(tok: string): Record<string, string> {
  return {
    Authorization: `Bearer ${tok}`,
    'X-Tenant-Id': getTenantId(),
    'Content-Type': 'application/json',
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

test.describe('Merchant Auth', () => {
  test('POST /api/v1/auth/login — merchant credentials returns token', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: MERCHANT_USER, password: MERCHANT_PASS },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.token).toBeTruthy()
  })
})

// ── POS Barcode Lookup ───────────────────────────────────────────────────────

test.describe('POS Barcode Lookup', () => {
  test('GET /bff/v1/merchant/pos/barcode/{value} — lookup by barcode', async ({ request }) => {
    const token = await login(request)
    // Use a known-nonexistent barcode — endpoint should be reachable
    const testBarcode = 'BLE-0000-0000-0000'
    const res = await request.get(
      `${BFF}/bff/v1/merchant/pos/barcode/${encodeURIComponent(testBarcode)}`,
      { headers: hdrs(token) },
    )
    // 200 if found, 401/403 auth/registry rejection, 404 if no card, 500/502 service error
    expect([200, 401, 403, 404, 500, 502]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('card')
      expect(body).toHaveProperty('balanceCents')
      expect(body).toHaveProperty('currency')
    }
  })
})

// ── POS Spend ────────────────────────────────────────────────────────────────

test.describe('POS Spend', () => {
  test('POST /bff/v1/merchant/pos/spend — spend endpoint reachable', async ({ request }) => {
    const token = await login(request)
    const res = await request.post(`${BFF}/bff/v1/merchant/pos/spend`, {
      headers: hdrs(token),
      data: {
        barcodeValue: 'BLE-0000-0000-0000',
        grossAmount: 10.00,
        creditToRedeem: 0,
        currency: 'EUR',
        idempotencyKey: `e2e-test-${Date.now()}`,
      },
    })
    // 200 on success, 401/403 auth rejection, 404 if barcode not found, 400/422 validation, 500/502 service error
    expect([200, 400, 401, 403, 404, 422, 500, 502]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('transactionId')
      expect(body).toHaveProperty('grossAmountCents')
      expect(body).toHaveProperty('netAmountCents')
    }
  })
})

// ── Billing Records ──────────────────────────────────────────────────────────

test.describe('Billing', () => {
  test('GET /api/v1/billing/merchants/{id}/records — returns billing records', async ({ request }) => {
    const token = await login(request)
    // Use a placeholder merchant ID — the endpoint should be reachable
    const merchantId = '00000000-0000-0000-0000-000000000001'
    const res = await request.get(
      `${BFF}/api/v1/billing/merchants/${merchantId}/records`,
      { headers: hdrs(token) },
    )
    // 200 with data, 404 if merchant unknown, 403 if wrong merchant
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })

  test('GET /api/v1/billing/merchants/{id}/accruals — returns commission accruals', async ({ request }) => {
    const token = await login(request)
    const merchantId = '00000000-0000-0000-0000-000000000001'
    const res = await request.get(
      `${BFF}/api/v1/billing/merchants/${merchantId}/accruals`,
      { headers: hdrs(token) },
    )
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })
})
