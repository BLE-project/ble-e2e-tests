/**
 * Global seed data helper — ensures a tenant + territory exist in the DB
 * before CRUD tests run. Idempotent: reuses existing data if present.
 */

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'

export interface SeedData {
  token: string
  tenantId: string
  tenantName: string
  territoryId: string
  territoryName: string
}

let _cache: SeedData | null = null

/**
 * Load seed data from the file written by global-setup (for test workers).
 */
export function loadSeedDataSync(): SeedData | null {
  try {
    const fs = require('fs')
    const raw = fs.readFileSync('./test-results/.seed-data.json', 'utf-8')
    return JSON.parse(raw) as SeedData
  } catch {
    return null
  }
}

/**
 * Get or create seed tenant + territory. Results are cached for the process lifetime.
 */
export async function ensureSeedData(): Promise<SeedData> {
  if (_cache) return _cache

  // Try to load from file first (written by global-setup)
  const fromFile = loadSeedDataSync()
  if (fromFile) {
    _cache = fromFile
    return _cache
  }

  // 1. Login as SUPER_ADMIN
  const loginRes = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  })
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`)
  const { token } = await loginRes.json() as { token: string }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': '00000000-0000-0000-0000-000000000001', // placeholder for creation
  }

  // 2. Find or create tenant
  const tenantsRes = await fetch(`${BFF_URL}/api/v1/tenants`, { headers })
  const tenants = tenantsRes.ok ? await tenantsRes.json() as Array<{ id: string; name: string }> : []

  let tenantId: string
  let tenantName: string

  const existing = tenants.find(t => t.name?.includes('E2E'))
  if (existing) {
    tenantId = existing.id
    tenantName = existing.name
  } else {
    const createRes = await fetch(`${BFF_URL}/api/v1/tenants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'E2E Dev Tenant', contactEmail: 'e2e@ble.local' }),
    })
    if (!createRes.ok) throw new Error(`Create tenant failed: ${createRes.status}`)
    const created = await createRes.json() as { id: string; name: string }
    tenantId = created.id
    tenantName = created.name
  }

  // 3. Find or create territory (using the real tenant ID now)
  const tenantHeaders = { ...headers, 'X-Tenant-Id': tenantId }
  const terrRes = await fetch(`${BFF_URL}/api/v1/territories`, { headers: tenantHeaders })
  const territories = terrRes.ok ? await terrRes.json() as Array<{ id: string; name: string }> : []

  let territoryId: string
  let territoryName: string

  const existingTerr = territories.find(t => t.name?.includes('E2E'))
  if (existingTerr) {
    territoryId = existingTerr.id
    territoryName = existingTerr.name
  } else {
    const createTerrRes = await fetch(`${BFF_URL}/api/v1/territories`, {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({ name: 'E2E Territory', tenantId }),
    })
    if (!createTerrRes.ok) throw new Error(`Create territory failed: ${createTerrRes.status}`)
    const created = await createTerrRes.json() as { id: string; name: string }
    territoryId = created.id
    territoryName = created.name
  }

  _cache = { token, tenantId, tenantName, territoryId, territoryName }
  return _cache
}
