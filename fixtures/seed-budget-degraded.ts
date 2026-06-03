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

export async function ensureBudgetDegradedAdv(): Promise<{ advId: string; created: boolean }> {
  const superToken  = await login('dev-super-admin')
  const tenantToken = await login('dev-tenant-admin')
  const tenantId    = tenantOf(tenantToken)
  const tHeaders = { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId }

  // Already seeded? (idempotent — the ADV keeps its no-verdict state.)
  const listed = await fetch(`${BFF_URL}/api/v1/adv`, { headers: tHeaders })
  if (listed.ok) {
    const advs = await listed.json() as Array<{ id: string; title: string }>
    const existing = advs.find((a) => a.title === BUDGET_DEGRADED_ADV_TITLE)
    if (existing) { console.log(`[seed] budget-degraded ADV present: ${existing.id}`); return { advId: existing.id, created: false } }
  }

  // Need a merchant to own the ADV.
  const merchantsRes = await fetch(`${BFF_URL}/api/v1/merchants`, { headers: tHeaders })
  const merchants = merchantsRes.ok ? await merchantsRes.json() as Array<{ id: string }> : []
  if (merchants.length === 0) throw new Error('no merchant in tenant to own the budget-degraded ADV')
  const merchantId = merchants[0].id

  try {
    // 1. Force HUMAN_ONLY.
    await setBudget(superToken, tenantId, HIGH_SPEND_USD)

    // 2. Submit → skips Claude → PENDING_HUMAN, no verdict.
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
    console.log(`[seed] created budget-degraded ADV ${adv.id} (HUMAN_ONLY, no verdict)`)
    return { advId: adv.id, created: true }
  } finally {
    // 3. Restore NORMAL tier so approve/reject ADVs get a Claude verdict.
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
