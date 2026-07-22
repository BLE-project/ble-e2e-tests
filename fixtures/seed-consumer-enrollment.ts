/**
 * Enroll dev-consumer in the E2E tenant so the consumer has an ACTIVE tenant
 * context:
 *   1. issue a loyalty card (POST /v1/loyalty-cards — authenticated CONSUMER,
 *      via the consumer bearer token) binding the consumer to the tenant + territory.
 *      issue() returns 409 CONFLICT if the consumer already has a card for that
 *      (tenant, territory) — we treat that as "already enrolled" and read the
 *      existing card back from GET /v1/loyalty-cards/me.
 *   2. switch the consumer's active context (PUT /bff/v1/consumer/context) — this
 *      requires an existing card (else 403 NO_CARD).
 *
 * The active context is what GET /bff/v1/consumer/brand resolves the tenant from,
 * so this is the precondition for the custom-branding brand-tag (theme.appName).
 * It also gives other consumer flows a real active programme.
 *
 * Idempotent. Run: BFF_URL=http://localhost:8082 npx tsx fixtures/seed-consumer-enrollment.ts
 */
import { ensureSeedData } from './seed-data'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

async function consumerLogin(): Promise<{ token: string; consumerId: string }> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dev-consumer', password: 'dev-pass' }),
  })
  if (!res.ok) throw new Error(`dev-consumer login failed: ${res.status}`)
  const { token } = await res.json() as { token: string }
  const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { sub?: string }
  if (!c.sub) throw new Error('dev-consumer token has no sub')
  return { token, consumerId: c.sub }
}

export interface ConsumerEnrollment {
  consumerId: string
  tenantId:   string
  territoryId: string
  cardId:     string
}

export async function ensureConsumerEnrollment(): Promise<ConsumerEnrollment> {
  const seed = await ensureSeedData()
  const { token, consumerId } = await consumerLogin()
  const tenantId = seed.tenantId
  const territoryId = seed.territoryId
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  }

  // 1. loyalty card via authenticated issue(). issue() 409s if the consumer
  //    already has a card for this (tenant, territory) — treat as already-enrolled
  //    and read the existing card back from /me (auto-create used to be idempotent).
  const cardRes = await fetch(`${BFF_URL}/api/v1/loyalty-cards`, {
    method: 'POST', headers,
    body: JSON.stringify({ consumerId, territoryId }),
  })
  let card: { id: string }
  if (cardRes.status === 409) {
    const meRes = await fetch(`${BFF_URL}/api/v1/loyalty-cards/me`, { headers })
    if (!meRes.ok) {
      throw new Error(`issue 409 + /me lookup failed: ${meRes.status} ${await meRes.text()}`)
    }
    const cards = await meRes.json() as { id: string; territoryId: string | null }[]
    const existing = cards.find((c) => c.territoryId === territoryId)
    if (!existing) {
      throw new Error(`issue 409 but no matching card for territory ${territoryId} in /me`)
    }
    card = existing
  } else if (!cardRes.ok) {
    throw new Error(`issue card failed: ${cardRes.status} ${await cardRes.text()}`)
  } else {
    card = await cardRes.json() as { id: string }
  }

  // 2. switch active tenant context (requires the card above)
  const ctxRes = await fetch(`${BFF_URL}/bff/v1/consumer/context`, {
    method: 'PUT', headers,
    body: JSON.stringify({ tenantId, source: 'MANUAL' }),
  })
  if (!ctxRes.ok) {
    throw new Error(`context switch failed: ${ctxRes.status} ${await ctxRes.text()}`)
  }

  console.log(`[seed-consumer-enrollment] consumer ${consumerId} → tenant ${tenantId} (card ${card.id})`)
  return { consumerId, tenantId, territoryId, cardId: card.id }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-consumer-enrollment\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureConsumerEnrollment()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((err) => { console.error('[seed-consumer-enrollment] FAILED:', err); process.exit(1) })
}
