/**
 * Seed a no-Claude-verdict ADV for moderation-budget-degraded.yaml.
 *
 * The flow asserts a PENDING_HUMAN ADV with NO "ANALISI AI" section — which only
 * happens when the budget tier is HUMAN_ONLY (spend ≥ 100% → Claude skipped).
 * approve/reject on the SAME tenant need the opposite (a Claude verdict), so we
 * can't leave the tenant HUMAN_ONLY. Instead:
 *   1. SUPER_ADMIN sets the tenant's monthly spend HIGH (→ HUMAN_ONLY)
 *      via POST /v1/adv/budget.
 *   2. Submit ONE ADV → it skips Claude → PENDING_HUMAN, no verdict.
 *   3. Reset spend to 0 (→ NORMAL) so the approve/reject ADVs keep getting
 *      verdicts.
 * The no-verdict ADV is the NEWEST → last in the queue (ordered by
 * salesReviewExpiresAt), so approve/reject (tap first row) hit a verdict ADV
 * while budget-degraded scrolls to this one by title.
 *
 * Idempotent. Run: BFF_URL=http://localhost:8082 npx tsx fixtures/seed-budget-degraded.ts
 */
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

export const BUDGET_DEGRADED_ADV_TITLE = 'E2E-BUDGET no-verdict ADV'
const HIGH_SPEND_USD = 1000   // ≫ the 50 EUR per-tenant budget → HUMAN_ONLY

async function login(user: string): Promise<string> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'dev-pass' }),
  })
  if (!res.ok) throw new Error(`login ${user} failed: ${res.status}`)
  return (await res.json() as { token: string }).token
}

function tenantOf(token: string): string {
  const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as
    { tenant_id?: string; ble_tenant_id?: string }
  const t = c.tenant_id ?? c.ble_tenant_id
  if (!t || t === '*') throw new Error(`no concrete tenant_id (${t})`)
  return t
}

async function setBudget(superToken: string, tenantId: string, costUsd: number): Promise<void> {
  const res = await fetch(`${BFF_URL}/api/v1/adv/budget`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
    body: JSON.stringify({ tenantId, costUsd }),
  })
  if (!res.ok) throw new Error(`set budget ${costUsd} failed: ${res.status} ${await res.text()}`)
}

type AdvRow = { id: string; title: string; claudeRiskLevel: string | null; moderationStatus: string }

// Resolve a stale queue entry (one that raced and picked up a Claude verdict)
// out of PENDING_HUMAN so it no longer shows in the moderation queue and the
// flow only sees the fresh no-verdict ADV. TOTP is disabled in e2e so no code.
async function rejectStale(token: string, tenantId: string, advId: string): Promise<void> {
  const res = await fetch(`${BFF_URL}/api/v1/moderation/reviews/${advId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
    body: JSON.stringify({ reason: 'e2e-seed: clearing stale budget-degraded ADV that raced into a verdict' }),
  })
  if (!res.ok && res.status !== 409) console.warn(`[seed] reject stale ${advId}: ${res.status} ${await res.text()}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Read the AUTHORITATIVE moderation state by id. The `/api/v1/adv` list is an
// async read-projection that lags submit by seconds, so a freshly-submitted
// PENDING_HUMAN ADV is briefly absent from it. The moderation-reviews endpoint
// reads the write model and reflects the worker's decision immediately.
async function getReview(headers: Record<string, string>, advId: string): Promise<AdvRow | null> {
  const r = await fetch(`${BFF_URL}/api/v1/moderation/reviews/${advId}`, { headers })
  if (!r.ok) return null
  const j = await r.json() as { advId: string; title: string; claudeRiskLevel: string | null; moderationStatus: string }
  return { id: j.advId, title: j.title, claudeRiskLevel: j.claudeRiskLevel, moderationStatus: j.moderationStatus }
}

// The human-review queue (PENDING_HUMAN + ESCALATED), authoritative + immediate.
async function listReviews(headers: Record<string, string>): Promise<AdvRow[]> {
  const r = await fetch(`${BFF_URL}/api/v1/moderation/reviews`, { headers })
  if (!r.ok) return []
  return (await r.json() as Array<{ advId: string; title: string; claudeRiskLevel: string | null; moderationStatus: string }>)
    .map((j) => ({ id: j.advId, title: j.title, claudeRiskLevel: j.claudeRiskLevel, moderationStatus: j.moderationStatus }))
}

// Poll the moderation state of `advId` until `pred` holds, or timeout.
async function pollReview(
  headers: Record<string, string>, advId: string,
  pred: (a: AdvRow) => boolean, timeoutMs = 20000,
): Promise<AdvRow | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const a = await getReview(headers, advId)
    if (a && pred(a)) return a
    await sleep(1000)
  }
  return null
}

export async function ensureBudgetDegradedAdv(): Promise<{ advId: string; created: boolean }> {
  const superToken  = await login('dev-super-admin')
  const tenantToken = await login('dev-tenant-admin')
  const tenantId    = tenantOf(tenantToken)
  const tHeaders = { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId }

  // Already seeded with a GENUINE no-verdict ADV? Reuse only a row that is in
  // the human queue (PENDING_HUMAN) AND carries no Claude verdict — that is the
  // exact state the flow asserts. Any other same-title row is stale (it raced
  // into a verdict on an earlier run); clear it out of the queue so the flow
  // doesn't tap it.
  const queued = (await listReviews(tHeaders)).filter((a) => a.title === BUDGET_DEGRADED_ADV_TITLE)
  const good = queued.find((a) => a.claudeRiskLevel == null && a.moderationStatus === 'PENDING_HUMAN')
  if (good) { console.log(`[seed] budget-degraded ADV present (no verdict): ${good.id}`); return { advId: good.id, created: false } }
  for (const stale of queued) {
    console.log(`[seed] clearing stale budget-degraded ADV ${stale.id} (verdict=${stale.claudeRiskLevel})`)
    await rejectStale(tenantToken, tenantId, stale.id)
  }

  // Need a merchant to own the ADV.
  const merchantsRes = await fetch(`${BFF_URL}/api/v1/merchants`, { headers: tHeaders })
  const merchants = merchantsRes.ok ? await merchantsRes.json() as Array<{ id: string }> : []
  if (merchants.length === 0) throw new Error('no merchant in tenant to own the budget-degraded ADV')
  const merchantId = merchants[0].id

  try {
    // 1. Force HUMAN_ONLY.
    await setBudget(superToken, tenantId, HIGH_SPEND_USD)

    // 2. Submit → the async moderation worker should skip Claude → PENDING_HUMAN.
    const res = await fetch(`${BFF_URL}/api/v1/adv`, {
      method: 'POST', headers: tHeaders,
      body: JSON.stringify({
        title: BUDGET_DEGRADED_ADV_TITLE,
        description: 'Budget HUMAN_ONLY: questa ADV salta l’analisi AI e va in coda umana.',
        discountType: 'percentage', discountValue: 10, merchantId,
      }),
    })
    if (!res.ok) throw new Error(`submit budget-degraded ADV failed: ${res.status} ${await res.text()}`)
    const adv = await res.json() as { id: string }

    // 3. CRITICAL race fix: keep the budget HIGH until the worker has actually
    //    processed the ADV into PENDING_HUMAN. The old code reset the budget in
    //    a `finally` that fired immediately after submit — the async worker then
    //    re-read the (now NORMAL) tier and ran Claude, so the ADV picked up a
    //    verdict and "ANALISI AI" showed. Wait for PENDING_HUMAN, dwell to let
    //    any in-flight evaluation finish (budget still HIGH so it skips Claude),
    //    then assert no verdict before restoring NORMAL.
    const settled = await pollReview(tHeaders, adv.id, (a) => a.moderationStatus === 'PENDING_HUMAN', 20000)
    if (!settled) throw new Error('budget-degraded ADV did not reach PENDING_HUMAN within 20s')
    await sleep(3000)
    const recheck = await getReview(tHeaders, adv.id)
    if (recheck?.claudeRiskLevel != null) {
      throw new Error(`budget tier not degraded: ADV ${adv.id} got Claude verdict ${recheck?.claudeRiskLevel}`)
    }
    console.log(`[seed] created budget-degraded ADV ${adv.id} (HUMAN_ONLY, no verdict, settled)`)
    return { advId: adv.id, created: true }
  } finally {
    // 4. Restore NORMAL tier so approve/reject ADVs get a Claude verdict.
    await setBudget(superToken, tenantId, 0)
    console.log('[seed] budget reset to 0 (NORMAL)')
  }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-budget-degraded\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureBudgetDegradedAdv()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((err) => { console.error('[seed-budget-degraded] FAILED:', err); process.exit(1) })
}
