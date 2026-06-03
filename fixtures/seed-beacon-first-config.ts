/**
 * Seed the data the sales-agent first-config wizard (beacon-first-config.yaml)
 * needs, fully via the API (no manual DB):
 *
 *   1. A merchant assigned to dev-sales-agent (assignedSalesAgentId) so it shows
 *      in "I tuoi merchant" (GET /v1/merchants?managedByAgent=true).
 *   2. A Store owned by that merchant (POST /v1/stores with merchantId — the
 *      field added in ble-core-registry to make this seedable without DB).
 *   3. A beacon assigned to that store (Beacon.assignedToStoreId) so
 *      GET /v1/merchants/{id}/beacons resolves ≥1 beacon for step-2 (scan).
 *
 * Idempotent — reuses existing rows by name.
 *
 * Run: BFF_URL=http://localhost:8082 npx tsx fixtures/seed-beacon-first-config.ts
 */
import { ensureSalesAgentTerritory } from './seed-sales-agent-territory'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const TENANT_ADMIN_USER = process.env.TENANT_ADMIN_USER ?? 'dev-tenant-admin'
const TENANT_ADMIN_PASS = process.env.TENANT_ADMIN_PASS ?? 'dev-pass'

const MERCHANT_NAME = 'E2E First-Config Merchant'
const STORE_NAME    = 'E2E First-Config Store'
const BEACON_NAME   = 'E2E First-Config Beacon'
const BEACON_UUID   = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825'
const BEACON_MAJOR  = 500
const BEACON_MINOR  = 500

async function loginTenantAdmin(): Promise<{ token: string; tenantId: string }> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: TENANT_ADMIN_USER, password: TENANT_ADMIN_PASS }),
  })
  if (!res.ok) throw new Error(`tenant-admin login failed: ${res.status} ${await res.text()}`)
  const { token } = (await res.json()) as { token: string }
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { tenant_id?: string; ble_tenant_id?: string }
  const tenantId = claims.tenant_id ?? claims.ble_tenant_id
  if (!tenantId || tenantId === '*') throw new Error(`tenant-admin has no concrete tenant_id (${tenantId})`)
  return { token, tenantId }
}

async function api<T>(token: string, tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Tenant-Id':  tenantId,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`)
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
}

export async function ensureBeaconFirstConfig(): Promise<{
  agentId: string; merchantId: string; storeId: string; beaconId: string
}> {
  const { agentId, territoryId } = await ensureSalesAgentTerritory()
  const { token, tenantId } = await loginTenantAdmin()

  // 1. Merchant assigned to the agent.
  const merchants = await api<Array<{ id: string; name: string }>>(token, tenantId, 'GET', '/api/v1/merchants')
  let merchant = merchants.find((m) => m.name === MERCHANT_NAME)
  if (!merchant) {
    merchant = await api<{ id: string; name: string }>(token, tenantId, 'POST', '/api/v1/merchants', {
      name: MERCHANT_NAME, email: 'e2e-firstconfig@ble.local', country: 'ITA',
      assignedSalesAgentId: agentId,
    })
    console.log(`[seed] created merchant ${merchant.id} (assigned agent ${agentId})`)
  }

  // 2. Store owned by the merchant.
  const stores = await api<Array<{ id: string; name: string }>>(token, tenantId, 'GET', '/api/v1/stores')
  let store = stores.find((s) => s.name === STORE_NAME)
  if (!store) {
    store = await api<{ id: string; name: string }>(token, tenantId, 'POST', '/api/v1/stores', {
      territoryId, name: STORE_NAME, lat: 45.07, lon: 7.69, merchantId: merchant.id,
    })
    console.log(`[seed] created store ${store.id} (merchant ${merchant.id})`)
  }

  // 3. Beacon assigned to the store.
  const beacons = await api<Array<{ id: string; name: string | null; assignedToStoreId: string | null }>>(
    token, tenantId, 'GET', '/api/v1/beacons')
  let beacon = beacons.find((b) => b.name === BEACON_NAME)
  if (!beacon) {
    beacon = await api<{ id: string; name: string | null; assignedToStoreId: string | null }>(
      token, tenantId, 'POST', '/api/v1/beacons', {
        territoryId, type: 'MERCHANT', ibeaconUuid: BEACON_UUID,
        major: BEACON_MAJOR, minor: BEACON_MINOR, name: BEACON_NAME,
        assignedToStoreId: store.id,
      })
    console.log(`[seed] created beacon ${beacon.id} (store ${store.id})`)
  } else if (beacon.assignedToStoreId !== store.id) {
    await api(token, tenantId, 'PUT', `/api/v1/beacons/${beacon.id}`, {
      territoryId, type: 'MERCHANT', ibeaconUuid: BEACON_UUID,
      major: BEACON_MAJOR, minor: BEACON_MINOR, assignedToStoreId: store.id,
    })
    console.log(`[seed] re-assigned beacon ${beacon.id} to store ${store.id}`)
  }

  return { agentId, merchantId: merchant.id, storeId: store.id, beaconId: beacon.id }
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-beacon-first-config\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureBeaconFirstConfig()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((err) => { console.error('[seed-beacon-first-config] FAILED:', err); process.exit(1) })
}
