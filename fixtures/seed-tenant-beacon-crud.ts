/**
 * Free the iBeacon-identity slot the tenant beacons CRUD flow
 * (maestro/tenant-mobile/beacons.yaml) creates: FDA50693-…-647825 / 999 / 1.
 *
 * The flow has no delete step (the app lacks per-row delete testIDs), so each
 * run leaves that beacon ACTIVE → the next run's create returns 409 and the flow
 * fails ("Beacon Registry" not shown after the error dialog). Soft-deleting any
 * active match before the suite lets the create run fresh — the V36 partial
 * unique index (WHERE deleted_at IS NULL) makes the soft-deleted slot reusable.
 *
 * Idempotent, API-only. Run: BFF_URL=http://localhost:8082 npx tsx fixtures/seed-tenant-beacon-crud.ts
 */
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const TENANT_ADMIN_USER = process.env.TENANT_ADMIN_USER ?? 'dev-tenant-admin'
const TENANT_ADMIN_PASS = process.env.TENANT_ADMIN_PASS ?? 'dev-pass'

const CRUD_UUID  = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825'
const CRUD_MAJOR = 999
const CRUD_MINOR = 1

async function loginTenantAdmin(): Promise<{ token: string; tenantId: string }> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: TENANT_ADMIN_USER, password: TENANT_ADMIN_PASS }),
  })
  if (!res.ok) throw new Error(`tenant-admin login failed: ${res.status} ${await res.text()}`)
  const { token } = (await res.json()) as { token: string }
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as
    { tenant_id?: string; ble_tenant_id?: string }
  const tenantId = claims.tenant_id ?? claims.ble_tenant_id
  if (!tenantId || tenantId === '*') throw new Error(`tenant-admin has no concrete tenant_id (${tenantId})`)
  return { token, tenantId }
}

export async function ensureTenantBeaconCrudSlotFree(): Promise<number> {
  const { token, tenantId } = await loginTenantAdmin()
  const headers = { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId }

  // GET /v1/beacons returns only ACTIVE rows (deletedAt IS NULL).
  const res = await fetch(`${BFF_URL}/api/v1/beacons`, { headers })
  if (!res.ok) throw new Error(`list beacons failed: ${res.status}`)
  const beacons = (await res.json()) as Array<{
    id: string; ibeaconUuid: string; major: number; minor: number
  }>

  const dupes = beacons.filter((b) =>
    b.ibeaconUuid?.toUpperCase() === CRUD_UUID && b.major === CRUD_MAJOR && b.minor === CRUD_MINOR)

  let deleted = 0
  for (const b of dupes) {
    const del = await fetch(`${BFF_URL}/api/v1/beacons/${b.id}`, { method: 'DELETE', headers })
    if (del.ok) { deleted++; console.log(`[seed] soft-deleted stale CRUD beacon ${b.id}`) }
    else console.warn(`[seed] could not delete beacon ${b.id}: ${del.status}`)
  }
  if (deleted === 0) console.log('[seed] tenant beacon CRUD slot already free')
  return deleted
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-tenant-beacon-crud\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureTenantBeaconCrudSlotFree()
    .then((n) => { console.log(`done: freed ${n}`); process.exit(0) })
    .catch((err) => { console.error('[seed-tenant-beacon-crud] FAILED:', err); process.exit(1) })
}
