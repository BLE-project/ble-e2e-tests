/**
 * §9bis M8 P0 fixture — seed 3 ADV campaigns in PENDING_HUMAN + 1 ESCALATED
 * + 1 REJECTED + 1 APPROVED so that Maestro moderation flows have concrete
 * rows to interact with.
 *
 * Targets terrio-notification-service /v1/adv with SUPER_ADMIN token obtained
 * via BFF /api/v1/auth/login. Idempotent — reuses existing ADVs by title
 * prefix "E2E-MOD-".
 *
 * Usage from CLI:
 *   npx tsx fixtures/seed-moderation-queue.ts
 *
 * Usage programmatically:
 *   import { ensureModerationQueue } from './seed-moderation-queue'
 *   const { advs } = await ensureModerationQueue()
 */
import { ensureSeedData } from './seed-data'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

// ADV submit + merchant create are tenant-scoped. notification-service's
// TenantValidator (and core-registry RLS) require X-Tenant-Id to match the JWT
// tenant_id claim. A SUPER_ADMIN token carries tenant_id="*" (≠ any real tenant)
// → 403 TENANT_MISMATCH on /v1/adv. So authenticate as a TENANT_ADMIN whose claim
// IS the target tenant, and derive the tenant id from that same claim so the
// header always equals the claim.
const TENANT_ADMIN_USER = process.env.TENANT_ADMIN_USER ?? 'dev-tenant-admin'
const TENANT_ADMIN_PASS = process.env.TENANT_ADMIN_PASS ?? 'dev-pass'

async function loginTenantAdmin(): Promise<{ token: string; tenantId: string }> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TENANT_ADMIN_USER, password: TENANT_ADMIN_PASS }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)')
    throw new Error(`Tenant-admin login failed: ${res.status} ${body}`)
  }
  const { token } = (await res.json()) as { token: string }
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { tenant_id?: string; ble_tenant_id?: string }
  const tenantId = claims.tenant_id ?? claims.ble_tenant_id
  if (!tenantId || tenantId === '*') {
    throw new Error(`Tenant-admin token has no concrete tenant_id claim (got "${tenantId}")`)
  }
  return { token, tenantId }
}

// The escalate action is @RolesAllowed(SALES_AGENT) — tenant-admin can't call it,
// so mint a sales-agent token for the explicit escalation step.
async function loginSalesAgent(): Promise<string> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dev-sales-agent', password: TENANT_ADMIN_PASS }),
  })
  if (!res.ok) throw new Error(`sales-agent login failed: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { token: string }).token
}

export interface ModerationSeedAdv {
  title: string
  description: string
  discountType: 'percentage' | 'fixed' | 'bogo' | 'free-item'
  discountValue: number
  expectedFinalStatus:
    | 'PENDING_HUMAN'
    | 'ESCALATED_TO_ADMIN'
    | 'APPROVED'
    | 'REJECTED'
}

/**
 * 5 seed ADVs covering all Maestro M8 P0/P1/P2 flow preconditions.
 * After workflow processing the final moderation_status should match
 * expectedFinalStatus (within 30s polling window).
 */
export const MODERATION_SEED_ADVS: ModerationSeedAdv[] = [
  {
    title:       'E2E-MOD-01 Sconto 10% selezione prodotti',
    description: 'Sconto del 10% su una selezione di prodotti a marchio per tutti i clienti fedeltà del circuito.',
    discountType:  'percentage',
    discountValue: 10,
    expectedFinalStatus: 'PENDING_HUMAN',
  },
  {
    title:       'E2E-MOD-02 BOGO pasta fresca',
    description: 'Acquista 1 confezione di pasta fresca del nostro laboratorio, la seconda in omaggio. Valido fino a esaurimento scorte.',
    discountType:  'bogo',
    discountValue: 0,
    expectedFinalStatus: 'PENDING_HUMAN',
  },
  {
    title:       'E2E-MOD-03 Sconto fisso 5 euro spesa minima',
    description: 'Sconto fisso di 5€ sulla spesa minima di 30€. Valido per clienti con card attiva da almeno 3 mesi.',
    discountType:  'fixed',
    discountValue: 5,
    expectedFinalStatus: 'PENDING_HUMAN',
  },
  {
    title:       'E2E-MOD-04 Escalation caso borderline',
    description: 'Promozione con claim fiscale borderline da valutare — serve per test P0 escalation flow tenant admin.',
    discountType:  'percentage',
    discountValue: 50,
    expectedFinalStatus: 'ESCALATED_TO_ADMIN',
  },
  {
    title:       'E2E-MOD-05 Appello su rifiuto precedente',
    description: 'ADV precedentemente rifiutata — merchant richiede riconsiderazione dopo aver corretto il claim.',
    discountType:  'percentage',
    discountValue: 15,
    expectedFinalStatus: 'REJECTED',
  },
]

export interface ModerationQueueResult {
  token:      string
  tenantId:   string
  merchantId: string
  advs: Array<{
    title: string
    id: string
    created: boolean
    expectedFinalStatus: ModerationSeedAdv['expectedFinalStatus']
  }>
}

let _cache: ModerationQueueResult | null = null

export async function ensureModerationQueue(): Promise<ModerationQueueResult> {
  if (_cache) return _cache

  // Ensure the canonical tenant + territory exist (uses the seed super-admin).
  await ensureSeedData()

  // Use a TENANT_ADMIN token for the tenant-scoped writes so X-Tenant-Id matches
  // the JWT claim (see loginTenantAdmin above).
  const { token, tenantId } = await loginTenantAdmin()

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id':  tenantId,
  }

  // 1. Ensure a merchant exists to own the ADVs.
  const merchantsRes = await fetch(`${BFF_URL}/api/v1/merchants`, { headers })
  let merchantId: string
  if (merchantsRes.ok) {
    const rows = (await merchantsRes.json()) as Array<{ id: string; name: string }>
    const existing = rows.find((m) => m.name?.startsWith('E2E-MOD Merchant'))
    if (existing) {
      merchantId = existing.id
    } else {
      const created = await fetch(`${BFF_URL}/api/v1/merchants`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name:    'E2E-MOD Merchant',
          email:   'e2e-mod@ble.local',
          country: 'ITA',
        }),
      })
      if (!created.ok) {
        const err = await created.text().catch(() => '(no body)')
        throw new Error(`Create merchant failed: ${created.status} ${err}`)
      }
      const body = (await created.json()) as { id: string }
      merchantId = body.id
    }
  } else {
    throw new Error(`GET /v1/merchants failed: ${merchantsRes.status}`)
  }

  // 2. Top up the review queue by CURRENT QUEUE STATE — NOT by title.
  //
  //    Moderation flows CONSUME rows: approve→APPROVED, reject→REJECTED,
  //    escalate→ESCALATED_TO_ADMIN, tenant-review→terminal. A title-keyed
  //    idempotent seed finds the (now terminal) ADVs by title and skips them,
  //    so the 2nd suite run onwards finds an EMPTY review queue and every
  //    moderation flow fails on "moderation-row not visible". Instead we
  //    reconcile toward a target number of ACTIONABLE rows, submitting fresh
  //    uniquely-titled ADVs to cover only the shortfall (bounded growth).
  //
  //    Review-queue scope (ReviewTaskResource GET /v1/moderation/reviews):
  //      SALES_AGENT  → PENDING_HUMAN only          (approve / reject / escalate)
  //      TENANT_ADMIN → PENDING_HUMAN + ESCALATED   (tenant-review)
  //    Per suite run the sales-agent flows consume 3 PENDING_HUMAN and the
  //    tenant flow consumes 1 ESCALATED_TO_ADMIN; keep a buffer above that.
  const TARGET_PENDING_HUMAN = 4
  const TARGET_ESCALATED     = 2

  const PENDING_TEMPLATE   = MODERATION_SEED_ADVS[0] // 10% → PENDING_HUMAN (with Claude verdict)
  const ESCALATED_TEMPLATE = MODERATION_SEED_ADVS[3] // 50% → ESCALATED_TO_ADMIN

  // ReviewTaskResource exposes the campaign id as `advId` (not `id`).
  type QueueRow = { advId: string; title: string; moderationStatus: string }
  const reviewQueue = async (): Promise<QueueRow[]> => {
    const r = await fetch(`${BFF_URL}/api/v1/moderation/reviews?size=100`, { headers })
    return r.ok ? ((await r.json()) as QueueRow[]) : []
  }
  const countStatus = (q: QueueRow[], s: string) =>
    q.filter((a) => a.moderationStatus === s).length

  const submitFresh = async (
    template: ModerationSeedAdv, title: string,
  ): Promise<string> => {
    const res = await fetch(`${BFF_URL}/api/v1/adv`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title,
        description:   template.description,
        discountType:  template.discountType,
        discountValue: template.discountValue,
        merchantId,
      }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '(no body)')
      throw new Error(`submit fresh ADV "${title}" failed: ${res.status} ${err}`)
    }
    return ((await res.json()) as { id: string }).id
  }

  const pollUntil = async (
    predicate: () => Promise<boolean>, timeoutMs = 45_000, stepMs = 2_000,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await predicate()) return true
      await new Promise((r) => setTimeout(r, stepMs))
    }
    return predicate()
  }

  // Unique per-run token so fresh titles never collide with terminal leftovers.
  const runToken = Date.now().toString(36)
  let q = await reviewQueue()
  const submittedTitles: string[] = []

  for (let i = countStatus(q, 'PENDING_HUMAN'); i < TARGET_PENDING_HUMAN; i++) {
    const title = `${PENDING_TEMPLATE.title} #${runToken}-${i}`
    await submitFresh(PENDING_TEMPLATE, title)
    submittedTitles.push(title)
  }
  const escalateAdvIds: string[] = []
  for (let i = countStatus(q, 'ESCALATED_TO_ADMIN'); i < TARGET_ESCALATED; i++) {
    const title = `${ESCALATED_TEMPLATE.title} #${runToken}-e${i}`
    escalateAdvIds.push(await submitFresh(ESCALATED_TEMPLATE, title))
    submittedTitles.push(title)
  }

  // Wait for the Claude wiremock + workflow to settle the new ADVs into
  // PENDING_HUMAN so they are actionable.
  if (submittedTitles.length > 0) {
    const settled = await pollUntil(async () =>
      countStatus(await reviewQueue(), 'PENDING_HUMAN') >= TARGET_PENDING_HUMAN)
    if (!settled) {
      console.warn('[seed-moderation-queue] pending_human did not reach target after poll')
    }
  }

  // The Claude wiremock returns MEDIUM for every ADV, so nothing auto-escalates.
  // Drive the escalate-template ADVs to ESCALATED_TO_ADMIN explicitly via the
  // SALES_AGENT escalate action so the tenant-review flow always has rows.
  if (escalateAdvIds.length > 0) {
    const saToken = await loginSalesAgent()
    const saHeaders = {
      Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId,
    }
    for (const advId of escalateAdvIds) {
      await pollUntil(async () =>
        (await reviewQueue()).some((r) => r.advId === advId && r.moderationStatus === 'PENDING_HUMAN'),
        20_000)
      const esc = await fetch(`${BFF_URL}/api/v1/moderation/reviews/${advId}/escalate`, {
        method: 'POST', headers: saHeaders,
        body: JSON.stringify({ reason: 'e2e-seed: ensure ESCALATED_TO_ADMIN rows for tenant-review' }),
      })
      if (!esc.ok) console.warn(`[seed-moderation-queue] escalate ${advId}: ${esc.status} ${await esc.text()}`)
    }
  }
  q = await reviewQueue()

  const results: ModerationQueueResult['advs'] = q.map((a) => ({
    title: a.title,
    id: a.advId,
    created: submittedTitles.includes(a.title),
    expectedFinalStatus:
      a.moderationStatus === 'ESCALATED_TO_ADMIN' ? 'ESCALATED_TO_ADMIN' : 'PENDING_HUMAN',
  }))

  console.log(
    `[seed-moderation-queue] queue ready: ` +
    `pending_human=${countStatus(q, 'PENDING_HUMAN')} ` +
    `escalated=${countStatus(q, 'ESCALATED_TO_ADMIN')} ` +
    `(submitted ${submittedTitles.length} fresh, token ${runToken})`,
  )

  _cache = { token, tenantId, merchantId, advs: results }
  return _cache
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /seed-moderation-queue\.(ts|js)$/.test(process.argv[1])

if (isDirectRun) {
  ensureModerationQueue()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(r, null, 2))
      process.exit(0)
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed-moderation-queue] FAILED:', err)
      process.exit(1)
    })
}
