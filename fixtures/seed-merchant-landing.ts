/**
 * Seed a PUBLISHED merchant "E2E Bar Centrale" so the consumer merchant-landing
 * flow can discover it (GET /v1/merchants/discover) and open its landing page
 * (GET /v1/merchants/{id}/landing → "Indicazioni"/"Chiama"/"Descrizione").
 *
 * tenant-admin: find-or-create the merchant → set landing content → publish.
 * Idempotent (find by name; publish is safe to re-apply). Fresh tenant-admin
 * token (avoids the long-run 401).
 *
 * Run: BFF_URL=http://localhost:8082 npx tsx fixtures/seed-merchant-landing.ts
 */
import { ensureSeedData } from './seed-data'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const MERCHANT_NAME = 'E2E Bar Centrale'

async function tenantAdminLogin(): Promise<{ token: string; tenantId: string }> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dev-tenant-admin', password: 'dev-pass' }),
  })
  if (!res.ok) throw new Error(`tenant-admin login failed: ${res.status}`)
  const { token } = await res.json() as { token: string }
  const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as
    { ble_tenant_id?: string; tenant_id?: string }
  const tenantId = c.ble_tenant_id ?? c.tenant_id ?? ''
  if (!tenantId || tenantId === '*') throw new Error(`no concrete tenant_id (${tenantId})`)
  return { token, tenantId }
}

export async function ensureMerchantLanding(): Promise<{ id: string; name: string; published: boolean }> {
  await ensureSeedData()
  const { token, tenantId } = await tenantAdminLogin()
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  }

  // 1. find-or-create the merchant
  const listRes = await fetch(`${BFF_URL}/api/v1/merchants`, { headers })
  const merchants = listRes.ok ? await listRes.json() as Array<{ id: string; name: string; landingStatus?: string }> : []
  let merchant = merchants.find((m) => m.name === MERCHANT_NAME)
  if (!merchant) {
    const createRes = await fetch(`${BFF_URL}/api/v1/merchants`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: MERCHANT_NAME, email: 'bar-centrale@ble.local', country: 'ITA',
        city: 'Sondrio', addressLine: 'Via Roma 1', phone: '+39 0342 000000',
      }),
    })
    if (!createRes.ok) throw new Error(`create merchant failed: ${createRes.status} ${await createRes.text()}`)
    merchant = await createRes.json() as { id: string; name: string }
  }
  const id = merchant.id

  // Ensure addressLine + phone are set (the landing CTAs "Indicazioni"/"Chiama"
  // are conditional on them) — also covers a merchant created by an earlier run
  // without these fields. Idempotent partial update.
  const updRes = await fetch(`${BFF_URL}/api/v1/merchants/${id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ city: 'Sondrio', addressLine: 'Via Roma 1', phone: '+39 0342 000000' }),
  })
  if (!updRes.ok) throw new Error(`update merchant failed: ${updRes.status} ${await updRes.text()}`)

  // 2. landing content (description is what the flow's "Descrizione" section needs)
  const putRes = await fetch(`${BFF_URL}/api/v1/merchants/${id}/landing`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      description: 'Bar storico nel centro: caffè, aperitivi e dolci artigianali. Passa a trovarci!',
    }),
  })
  if (!putRes.ok) throw new Error(`PUT landing failed: ${putRes.status} ${await putRes.text()}`)

  // 3. publish (idempotent; only TENANT_ADMIN/SUPER_ADMIN)
  const pubRes = await fetch(`${BFF_URL}/api/v1/merchants/${id}/landing/publish`, {
    method: 'POST', headers,
  })
  if (!pubRes.ok) throw new Error(`publish landing failed: ${pubRes.status} ${await pubRes.text()}`)

  // 4. verify published
  const verRes = await fetch(`${BFF_URL}/api/v1/merchants/${id}/landing`, { headers })
  const ver = verRes.ok ? await verRes.json() as { landingStatus?: string } : {}
  const published = ver.landingStatus === 'PUBLISHED'

  console.log(`[seed-merchant-landing] ${MERCHANT_NAME} id=${id} published=${published}`)
  return { id, name: MERCHANT_NAME, published }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-merchant-landing\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureMerchantLanding()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((err) => { console.error('[seed-merchant-landing] FAILED:', err); process.exit(1) })
}
