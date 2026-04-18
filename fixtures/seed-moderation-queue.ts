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

  const base = await ensureSeedData()
  const { token, tenantId } = base

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

  // 2. List existing E2E-MOD ADVs (idempotent)
  const advListRes = await fetch(`${BFF_URL}/api/v1/adv`, { headers })
  const existingAdvs = advListRes.ok
    ? ((await advListRes.json()) as Array<{ id: string; title: string }>)
    : []

  const results: ModerationQueueResult['advs'] = []

  for (const seed of MODERATION_SEED_ADVS) {
    const already = existingAdvs.find((a) => a.title === seed.title)
    if (already) {
      results.push({
        title: seed.title,
        id: already.id,
        created: false,
        expectedFinalStatus: seed.expectedFinalStatus,
      })
      continue
    }
    const createRes = await fetch(`${BFF_URL}/api/v1/adv`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title:          seed.title,
        description:    seed.description,
        discountType:   seed.discountType,
        discountValue:  seed.discountValue,
        merchantId,
      }),
    })
    if (!createRes.ok) {
      const err = await createRes.text().catch(() => '(no body)')
      throw new Error(`Create ADV "${seed.title}" failed: ${createRes.status} ${err}`)
    }
    const body = (await createRes.json()) as { id: string }
    results.push({
      title: seed.title,
      id: body.id,
      created: true,
      expectedFinalStatus: seed.expectedFinalStatus,
    })
  }

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
