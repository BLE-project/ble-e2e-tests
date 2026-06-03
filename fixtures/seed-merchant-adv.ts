/**
 * Seed dev-merchant-owned ADVs in APPROVED + REJECTED state so the merchant
 * ADV UI flows have cards to act on:
 *   - adv-takedown needs an APPROVED ADV (the "Ritira ADV" button)
 *   - adv-appeal   needs a REJECTED ADV (the "Fai appello" button)
 *
 * dev-merchant submits each ADV (the backend stamps merchantId from the
 * ble_merchant_id claim — set by global-setup ensureMerchantClaim), then a
 * tenant-admin drives it through the moderation review (PENDING_HUMAN →
 * approve/reject). Idempotent: skips a state that already has an owned ADV.
 *
 * Run: BFF_URL=http://localhost:8082 npx tsx fixtures/seed-merchant-adv.ts
 */
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

const APPROVED_TITLE = 'E2E-MERCH approvata'
const REJECTED_TITLE = 'E2E-MERCH rifiutata'

interface AdvRow { id: string; title: string; moderationStatus: string; merchantId?: string }

async function login(user: string): Promise<{ token: string; tenantId: string }> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'dev-pass' }),
  })
  if (!res.ok) throw new Error(`login ${user} failed: ${res.status}`)
  const { token } = await res.json() as { token: string }
  const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as
    { ble_tenant_id?: string; tenant_id?: string }
  return { token, tenantId: c.ble_tenant_id ?? c.tenant_id ?? '' }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function ensureMerchantAdvData(
  _merchantId: string,
): Promise<{ approved: boolean; rejected: boolean }> {
  const merchant = await login('dev-merchant')
  const admin    = await login('dev-tenant-admin')
  const mHeaders = { Authorization: `Bearer ${merchant.token}`, 'Content-Type': 'application/json', 'X-Tenant-Id': merchant.tenantId }
  const aHeaders = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json', 'X-Tenant-Id': admin.tenantId }

  const listOwn = async (): Promise<AdvRow[]> => {
    const r = await fetch(`${BFF_URL}/api/v1/adv`, { headers: mHeaders })
    if (!r.ok) throw new Error(`GET /v1/adv (merchant) failed: ${r.status} ${await r.text()}`)
    return await r.json() as AdvRow[]
  }

  const has = (rows: AdvRow[], statuses: string[], title: string) =>
    rows.some((a) => statuses.includes(a.moderationStatus) && a.title === title)

  // Submit an ADV as dev-merchant, wait until it leaves PENDING_AI (→ PENDING_HUMAN
  // or a terminal state if the Claude stub decided on its own), return the row.
  const submitAndWait = async (title: string): Promise<AdvRow> => {
    const res = await fetch(`${BFF_URL}/api/v1/adv`, {
      method: 'POST', headers: mHeaders,
      body: JSON.stringify({
        title,
        description: 'Promozione e2e per il ciclo di moderazione merchant (analisi umana richiesta).',
        discountType: 'percentage', discountValue: 10,
      }),
    })
    if (!res.ok) throw new Error(`submit "${title}" failed: ${res.status} ${await res.text()}`)
    const adv = await res.json() as AdvRow
    for (let i = 0; i < 30; i++) {
      const rows = await listOwn()
      const cur = rows.find((a) => a.id === adv.id)
      if (cur && cur.moderationStatus !== 'PENDING_AI' && cur.moderationStatus !== 'DRAFT') return cur
      await sleep(2000)
    }
    return adv
  }

  // Drive a PENDING_HUMAN ADV to a terminal state via the tenant-admin review.
  const review = async (advId: string, action: 'approve' | 'reject') => {
    const res = await fetch(`${BFF_URL}/api/v1/moderation/reviews/${advId}/${action}`, {
      method: 'POST', headers: aHeaders,
      body: JSON.stringify({ reason: `e2e seed ${action}` }),
    })
    if (!res.ok) throw new Error(`${action} ${advId} failed: ${res.status} ${await res.text()}`)
  }

  let rows = await listOwn()
  let approved = has(rows, ['APPROVED'], APPROVED_TITLE)
  let rejected = has(rows, ['REJECTED', 'AUTO_REJECTED'], REJECTED_TITLE)

  if (!approved) {
    const adv = await submitAndWait(APPROVED_TITLE)
    if (adv.moderationStatus === 'APPROVED') approved = true
    else if (adv.moderationStatus === 'PENDING_HUMAN' || adv.moderationStatus === 'ESCALATED_TO_ADMIN') {
      await review(adv.id, 'approve'); approved = true
    } else {
      console.warn(`[seed-merchant-adv] approved ADV stuck in ${adv.moderationStatus}`)
    }
  }

  if (!rejected) {
    const adv = await submitAndWait(REJECTED_TITLE)
    if (adv.moderationStatus === 'REJECTED' || adv.moderationStatus === 'AUTO_REJECTED') rejected = true
    else if (adv.moderationStatus === 'PENDING_HUMAN' || adv.moderationStatus === 'ESCALATED_TO_ADMIN') {
      await review(adv.id, 'reject'); rejected = true
    } else {
      console.warn(`[seed-merchant-adv] rejected ADV stuck in ${adv.moderationStatus}`)
    }
  }

  rows = await listOwn()
  console.log(
    `[seed-merchant-adv] own ADVs: ${rows.length} ` +
    `(approved=${has(rows, ['APPROVED'], APPROVED_TITLE)} ` +
    `rejected=${has(rows, ['REJECTED', 'AUTO_REJECTED'], REJECTED_TITLE)})`,
  )
  return { approved, rejected }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-merchant-adv\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureMerchantAdvData('cli')
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((err) => { console.error('[seed-merchant-adv] FAILED:', err); process.exit(1) })
}
