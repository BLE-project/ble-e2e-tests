/**
 * Seed: one unread consumer-inbox notification for dev-consumer (#106 / GAP-025).
 *
 * The inbox UI flow (maestro/consumer-mobile/inbox-persist-mark-read.yaml) needs a
 * deterministic unread row. The production persistence path is async (beacon event
 * → Kafka → stream-processing → DispatchOrchestrator.persistInbox), which is great
 * for the API-level e2e (beacon-push-fcm.spec.ts Step 2b) but too flaky to gate a
 * UI flow. So we write the row the dispatcher would write, straight into the
 * notification-service table `consumer_notification` (DB `ble`).
 *
 * The inbox GET keys on (tenant_id, consumer_id), where consumer_id is the principal
 * name (preferred_username = "dev-consumer", per notification-service#101). Consumer
 * JWTs carry the cross-tenant claim ANY, so the concrete tenant comes from the
 * canonical enrollment fixture and remains correct after a DB reset.
 *
 *   BFF_URL=http://localhost:8082 npx tsx fixtures/seed-consumer-notification.ts
 */
import { Client } from 'pg'
import { ensureConsumerEnrollment } from './seed-consumer-enrollment'

const CONSUMER = process.env.CONSUMER_USER ?? 'dev-consumer'
const DB = process.env.NOTIF_DB ?? 'ble'

export async function ensureConsumerNotification(): Promise<void> {
  // The consumer JWT is intentionally cross-tenant (`tenant_id=ANY`). Resolve
  // the concrete active programme through the canonical enrollment fixture.
  const { tenantId } = await ensureConsumerEnrollment()

  const db = new Client({
    host: process.env.NOTIF_DB_HOST ?? 'localhost',
    port: Number(process.env.NOTIF_DB_PORT ?? process.env.POSTGRES_HOST_PORT ?? 5435),
    database: DB,
    user: process.env.POSTGRES_USER ?? 'ble',
    password: process.env.POSTGRES_PASSWORD ?? 'ble',
  })

  // Idempotent: mark any existing unread rows read, drop prior seed rows, then
  // insert exactly one fresh unread row. The UI flow asserts that the mark-all
  // affordance disappears after tapping the seeded row, so unrelated unread
  // notifications from previous e2e flows must not leak into this precondition.
  // Values are parameterized; the three mutations run atomically.
  const title = 'Offerta vicino a te'
  const body  = 'Un punto vendita aderente ha una promo attiva. Tocca per scoprirla.'
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query(
      `UPDATE consumer_notification SET read_at = COALESCE(read_at, now())
       WHERE tenant_id = $1 AND consumer_id = $2 AND read_at IS NULL`,
      [tenantId, CONSUMER],
    )
    await db.query(
      `DELETE FROM consumer_notification
       WHERE tenant_id = $1 AND consumer_id = $2 AND kind = 'e2e-inbox-seed'`,
      [tenantId, CONSUMER],
    )
    await db.query(
      `INSERT INTO consumer_notification
         (tenant_id, consumer_id, title, body, deep_link, kind, channel, read_at)
       VALUES ($1, $2, $3, $4, 'terrio://inbox', 'e2e-inbox-seed', 'beacon-context', NULL)`,
      [tenantId, CONSUMER, title, body],
    )
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await db.end()
  }

  // eslint-disable-next-line no-console
  console.log(`[seed-consumer-notification] 1 unread row for ${CONSUMER} (tenant ${tenantId})`)
}

if (process.argv[1] && process.argv[1].endsWith('seed-consumer-notification.ts')) {
  ensureConsumerNotification()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[seed-consumer-notification] FAILED:', err); process.exit(1) })
}
