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
 * The inbox GET keys on (tenant_id, consumer_id) where consumer_id is the principal
 * NAME (preferred_username = "dev-consumer", per notification-service#101) and
 * tenant_id is the consumer's JWT tenant claim. We resolve both from a live login
 * so a DB reset that re-mints the tenant id still seeds the right row.
 *
 *   BFF_URL=http://localhost:8082 npx tsx fixtures/seed-consumer-notification.ts
 */
import { execFileSync } from 'node:child_process'

const BFF = process.env.BFF_URL ?? 'http://localhost:8082'
const CONSUMER = process.env.CONSUMER_USER ?? 'dev-consumer'
const PASSWORD = process.env.DEV_PASS ?? 'dev-pass'
const DB = process.env.NOTIF_DB ?? 'ble'

function jwtClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

/** Run a psql command inside a container via execFileSync (no shell → no
 *  injection); returns trimmed stdout, or null on any failure. */
function psql(container: string, user: string, sql: string): string | null {
  try {
    return execFileSync(
      'docker',
      ['exec', container, 'psql', '-U', user, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return null
  }
}

/** Resolve the e2e-stack postgres container (works local + CI, ignores other
 *  compose stacks on the host) by finding the one whose `ble` DB owns the
 *  consumer_notification table. */
function resolvePostgres(): { container: string; user: string } {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => /postgres/i.test(s))
  const users = [process.env.POSTGRES_USER, 'ble_dev', 'ble', 'postgres'].filter(Boolean) as string[]
  for (const container of names) {
    for (const user of users) {
      if (psql(container, user, "SELECT to_regclass('public.consumer_notification')") === 'consumer_notification') {
        return { container, user }
      }
    }
  }
  throw new Error('could not find the e2e postgres container with consumer_notification')
}

function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export async function ensureConsumerNotification(): Promise<void> {
  const res = await fetch(`${BFF}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: CONSUMER, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`login ${CONSUMER} → ${res.status} ${await res.text().catch(() => '')}`)
  const token = (await res.json() as { token?: string }).token
  if (!token) throw new Error('login returned no token')

  const claims = jwtClaims(token)
  const tenantId = String(claims.ble_tenant_id ?? claims.tenant_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error(`bad tenant claim: "${tenantId}"`)

  const { container, user } = resolvePostgres()

  // Idempotent: drop prior seed rows then insert exactly one fresh unread row, so
  // the flow always starts from a known "one unread notification" state. The only
  // interpolated value is the regex-validated UUID tenantId; title/body/kind are
  // constants. Executed via execFileSync (no shell).
  const title = 'Offerta vicino a te'
  const body  = 'Un punto vendita aderente ha una promo attiva. Tocca per scoprirla.'
  const sql =
    `DELETE FROM consumer_notification WHERE consumer_id = ${sqlLit(CONSUMER)} AND kind = 'e2e-inbox-seed'; ` +
    `INSERT INTO consumer_notification (tenant_id, consumer_id, title, body, deep_link, kind, channel, read_at) ` +
    `VALUES (${sqlLit(tenantId)}, ${sqlLit(CONSUMER)}, ${sqlLit(title)}, ${sqlLit(body)}, 'terrio://inbox', 'e2e-inbox-seed', 'beacon-context', NULL);`

  if (psql(container, user, sql) === null) {
    throw new Error('insert into consumer_notification failed')
  }

  // eslint-disable-next-line no-console
  console.log(`[seed-consumer-notification] 1 unread row for ${CONSUMER} (tenant ${tenantId}) via ${container}`)
}

if (process.argv[1] && process.argv[1].endsWith('seed-consumer-notification.ts')) {
  ensureConsumerNotification()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[seed-consumer-notification] FAILED:', err); process.exit(1) })
}
