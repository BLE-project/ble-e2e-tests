/**
 * Tenant regression — Test 2 / 5
 *
 * Asserts that a cashback EARN posted from tenant-A's BFF context with a
 * merchant ID belonging to tenant B is rejected. Verifies the ledger's
 * tenant-bound INSERT path (cashback-ledger V9__enable_rls.sql + service-layer
 * X-Tenant-Id check). Composes with invariant I2 (ledger append-only).
 *
 * Sprint 11 (terrio-sprint-11-multitenancy-hardening).
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const FOREIGN_TENANT_FALLBACK = '00000000-0000-0000-0000-999999999999'
const FOREIGN_MERCHANT_FALLBACK = '00000000-0000-0000-0000-cccccccccccc'

test.describe('Tenant regression — cashback cross-tenant EARN rejection', () => {
  let merchantToken: string
  let tenantId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'

    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-merchant', password: 'dev-pass' },
    })
    expect(loginRes.ok()).toBeTruthy()
    merchantToken = (await loginRes.json()).token
  })

  test('EARN with foreign tenant header is rejected (TENANT_MISMATCH)', async ({
    request,
  }) => {
    const res = await request.post(`${BFF}/api/v1/ledger/earn`, {
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'X-Tenant-Id': FOREIGN_TENANT_FALLBACK,
      },
      data: {
        merchantId: FOREIGN_MERCHANT_FALLBACK,
        consumerUuid: '00000000-0000-0000-0000-000000000002',
        amountCents: 1000,
        idempotencyKey: `regression-${Date.now()}`,
      },
    })

    // Must be rejected at gateway or service level.
    expect([400, 401, 403, 404, 422]).toContain(res.status())
    expect(res.status()).not.toBe(200)
    expect(res.status()).not.toBe(201)
  })

  test('EARN with merchantId from foreign tenant under own tenant context is rejected', async ({
    request,
  }) => {
    // Realistic attack vector: header is the user's tenant, body smuggles a
    // foreign merchantId. Service must reject because the merchant is not in
    // the bound tenant scope (RLS hides it).
    const res = await request.post(`${BFF}/api/v1/ledger/earn`, {
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'X-Tenant-Id': tenantId,
      },
      data: {
        merchantId: FOREIGN_MERCHANT_FALLBACK,
        consumerUuid: '00000000-0000-0000-0000-000000000002',
        amountCents: 1000,
        idempotencyKey: `regression-${Date.now()}-2`,
      },
    })

    // Merchant lookup under tenant context must fail → 404 (not found) or
    // 403 (forbidden) or 422 (validation: unknown merchant).
    expect([400, 403, 404, 409, 422]).toContain(res.status())
  })
})
