import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { loadSeedDataSync } from '../../fixtures/seed-data'

/**
 * #86 — Consumer notification inbox, end-to-end (the half GAP-025 never covered).
 *
 * The pre-existing `beacon-notification.spec` stops at the FCM boundary and
 * tolerates 404/500 (status-set `[200,400,404,500]`) — false-positive coverage.
 * This spec asserts the REAL persist → inbox → mark-read → reflect path against
 * the live stack:
 *   1. seed one unread inbox row (fixtures/seed-consumer-notification.ts)
 *   2. GET  /bff/v1/consumer/notifications → the row is present and UNREAD
 *   3. PUT  /bff/v1/consumer/notifications/{id}/read → 200
 *   4. GET  again → the same row now carries a non-null readAt
 *
 * Requires the e2e-compose stack (BFF + notification-service + postgres); it is a
 * stack integration test (like the other mobile-api specs), not a local unit.
 */
const BFF      = process.env.BFF_URL ?? 'http://localhost:8082'
const CONSUMER = process.env.CONSUMER_USER ?? 'dev-consumer'
const PASS     = process.env.DEV_PASS ?? 'dev-pass'

interface InboxRow { id: string; title: string; readAt: string | null }
interface InboxResponse { notifications: InboxRow[]; totalCount: number }

test.describe('Consumer notification inbox — end-to-end (#86)', () => {
  let token = ''
  let tenantId = ''

  test.beforeAll(async ({ request }) => {
    // Deterministic: insert one unread inbox row for dev-consumer. Its JWT carries
    // tenant_id=ANY, so both the seed and the request use the concrete enrolled
    // tenant recorded by global setup.
    execFileSync('npx', ['tsx', 'fixtures/seed-consumer-notification.ts'], {
      env: { ...process.env, BFF_URL: BFF },
      stdio: 'inherit',
    })
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: CONSUMER, password: PASS },
    })
    expect(res.ok(), `consumer login failed: ${res.status()}`).toBeTruthy()
    token = (await res.json()).token
    expect(token).toBeTruthy()
    tenantId = loadSeedDataSync()?.tenantId ?? ''
    expect(tenantId, 'seed tenant missing').toMatch(/^[0-9a-f-]{36}$/i)
  })

  test('seeded notification is unread, then mark-read sets readAt', async ({ request }) => {
    const headers = { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId }

    // 2. inbox returns the seeded row, unread
    let res = await request.get(`${BFF}/bff/v1/consumer/notifications`, { headers })
    expect(res.ok(), `inbox GET failed: ${res.status()}`).toBeTruthy()
    let body = (await res.json()) as InboxResponse
    expect(body.notifications.length).toBeGreaterThan(0)
    const unread = body.notifications.find((n) => n.readAt == null)
    expect(unread, 'no unread inbox row after seeding').toBeTruthy()
    const id = unread!.id

    // 3. mark-read (idempotent, ownership-scoped)
    const mark = await request.put(`${BFF}/bff/v1/consumer/notifications/${id}/read`, { headers })
    expect(mark.ok(), `mark-read failed: ${mark.status()}`).toBeTruthy()

    // 4. inbox now reflects the read state for that row
    res = await request.get(`${BFF}/bff/v1/consumer/notifications`, { headers })
    expect(res.ok()).toBeTruthy()
    body = (await res.json()) as InboxResponse
    const updated = body.notifications.find((n) => n.id === id)
    expect(updated, 'previously-seeded row vanished from inbox').toBeTruthy()
    expect(updated!.readAt, 'readAt was not set after mark-read').not.toBeNull()
  })

  test('mark-read on a foreign / non-existent id is 404 (not 403 — no existence oracle)', async ({ request }) => {
    const headers = { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId }
    const res = await request.put(
      `${BFF}/bff/v1/consumer/notifications/00000000-0000-0000-0000-0000000000ff/read`,
      { headers },
    )
    expect(res.status()).toBe(404)
  })
})
