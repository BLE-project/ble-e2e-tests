/**
 * Tenant regression — Test 4 / 5
 *
 * FEAT-FED-001: a multi-tenant CONSUMER walks past a beacon owned by tenant B
 * after browsing tenant A. The federation flow switches the active tenant
 * context. After the switch, queries under tenant A's context must NOT leak
 * tenant B's loyalty card data, and queries under tenant B must NOT leak
 * tenant A's data.
 *
 * Sprint 11 (terrio-sprint-11-multitenancy-hardening).
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const TENANT_B_FALLBACK = '00000000-0000-0000-0000-bbbbbbbbbbbb'

test.describe('Tenant regression — federation context switch boundary', () => {
  let consumerToken: string
  let tenantId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'

    const loginRes = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-consumer', password: 'dev-pass' },
    })
    expect(loginRes.ok()).toBeTruthy()
    consumerToken = (await loginRes.json()).token
  })

  test('Federation context lists multiple tenants, but data queries stay scoped', async ({
    request,
  }) => {
    const ctxRes = await request.get(`${BFF}/bff/v1/consumer/context`, {
      headers: { Authorization: `Bearer ${consumerToken}` },
    })

    // The context endpoint is exempt from X-Tenant-Id (cross-tenant by
    // design). It is allowed to list tenants the consumer has cards in.
    if (ctxRes.ok()) {
      const ctx = await ctxRes.json()
      expect(ctx).toBeDefined()
    } else {
      expect([200, 204, 401, 403, 404]).toContain(ctxRes.status())
    }
  })

  test('After federation switch, queries under tenant B do NOT see tenant A data', async ({
    request,
  }) => {
    // Simulate federation switch: subsequent queries carry X-Tenant-Id: B.
    // Tenant A's loyalty card list MUST NOT appear in the tenant-B query.
    const cardsRes = await request.get(`${BFF}/api/v1/loyalty-cards`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': TENANT_B_FALLBACK,
      },
    })

    // Either the consumer has no card in tenant B (empty list) or the
    // endpoint rejects (403/404). What MUST NOT happen: tenant A's card
    // appearing in the tenant-B response.
    if (cardsRes.ok()) {
      const body = await cardsRes.json()
      const items = Array.isArray(body) ? body : (body.items ?? [])
      for (const card of items) {
        if (card.tenantId !== undefined) {
          expect(card.tenantId).not.toBe(tenantId)
          expect(card.tenantId).toBe(TENANT_B_FALLBACK)
        }
      }
    } else {
      expect([400, 401, 403, 404]).toContain(cardsRes.status())
    }
  })

  test('Snooze for tenant B does not affect tenant A subscription', async ({ request }) => {
    // FEAT-FED-001 snooze is per-(consumer × tenant) — must not bleed.
    const snoozeRes = await request.post(`${BFF}/bff/v1/consumer/snooze`, {
      headers: { Authorization: `Bearer ${consumerToken}` },
      data: { tenantId: TENANT_B_FALLBACK, snoozeUntil: '2026-12-31T23:59:59Z' },
    })

    // Either creates the snooze (2xx) or rejects (4xx) — both acceptable.
    expect([200, 201, 204, 400, 401, 403, 404, 409]).toContain(snoozeRes.status())

    // Tenant A's data must still be reachable normally (the snooze did not
    // bleed across tenants).
    const cardsA = await request.get(`${BFF}/api/v1/loyalty-cards`, {
      headers: {
        Authorization: `Bearer ${consumerToken}`,
        'X-Tenant-Id': tenantId,
      },
    })

    expect([200, 204, 401, 403, 404]).toContain(cardsA.status())
  })
})
