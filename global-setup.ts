/**
 * Playwright global setup — runs ONCE before all tests.
 * Creates a tenant + territory in the database so CRUD tests
 * have valid data for dropdown selects and relationships.
 *
 * The created IDs are stored in environment variables so tests
 * can access them via process.env.
 */
import { ensureSeedData } from './fixtures/seed-data'

const KC_URL = process.env.KC_URL ?? 'http://localhost:8180'

/**
 * Update Keycloak dev users' ble_tenant_id attribute to match the seed tenant.
 * This is required because Keycloak 25's Declarative User Profile needs the
 * attribute declared AND set on users for the protocol mapper to include it
 * in the JWT token.
 */
async function syncKeycloakUsers(tenantId: string) {
  // Get KC admin token
  const tokenRes = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&client_id=admin-cli&username=admin&password=admin',
  })
  if (!tokenRes.ok) { console.warn('[global-setup] KC admin login failed'); return }
  const { access_token: kcToken } = await tokenRes.json() as { access_token: string }
  const hdrs = { Authorization: `Bearer ${kcToken}`, 'Content-Type': 'application/json' }
  const base = `${KC_URL}/admin/realms/ble`

  // Ensure ble_tenant_id is declared in user profile schema
  const profileRes = await fetch(`${base}/users/profile`, { headers: hdrs })
  if (profileRes.ok) {
    const profile = await profileRes.json() as { attributes: Array<{ name: string }> }
    if (!profile.attributes.some(a => a.name === 'ble_tenant_id')) {
      profile.attributes.push({
        name: 'ble_tenant_id', displayName: 'BLE Tenant ID',
        permissions: { view: ['admin', 'user'], edit: ['admin'] },
        validations: {}, multivalued: false,
      } as any)
      await fetch(`${base}/users/profile`, { method: 'PUT', headers: hdrs, body: JSON.stringify(profile) })
      console.log('[global-setup] Added ble_tenant_id to KC user profile schema')
    }
  }

  // Update each dev user
  const users: Record<string, [string, string, string]> = {
    'dev-super-admin': ['Dev', 'SuperAdmin', '*'],
    'dev-tenant-admin': ['Dev', 'TenantAdmin', tenantId],
    'dev-merchant': ['Dev', 'Merchant', tenantId],
    'dev-consumer': ['Dev', 'Consumer', tenantId],
    'dev-pa-analyst': ['Dev', 'Analyst', tenantId],
    'dev-sales-agent': ['Dev', 'SalesAgent', tenantId],
    'dev-territory-admin': ['Dev', 'TerritoryAdmin', tenantId],
  }

  for (const [uname, [fn, ln, tid]] of Object.entries(users)) {
    const searchRes = await fetch(`${base}/users?username=${uname}&exact=true`, { headers: hdrs })
    if (!searchRes.ok) continue
    const found = await searchRes.json() as Array<{ id: string }>
    if (found.length === 0) continue

    await fetch(`${base}/users/${found[0].id}`, {
      method: 'PUT', headers: hdrs,
      body: JSON.stringify({
        email: `${uname}@ble.local`, firstName: fn, lastName: ln,
        emailVerified: true, attributes: { ble_tenant_id: [tid] },
      }),
    })
  }
  // Ensure ble-identity client has the protocol mapper for ble_tenant_id
  const clientsRes = await fetch(`${base}/clients?clientId=ble-identity`, { headers: hdrs })
  if (clientsRes.ok) {
    const clients = await clientsRes.json() as Array<{ id: string }>
    if (clients.length > 0) {
      const clientUuid = clients[0].id
      const mappersRes = await fetch(`${base}/clients/${clientUuid}/protocol-mappers/models`, { headers: hdrs })
      const mappers = mappersRes.ok ? await mappersRes.json() as Array<{ name: string }> : []
      if (!mappers.some(m => m.name === 'ble_tenant_id')) {
        await fetch(`${base}/clients/${clientUuid}/protocol-mappers/models`, {
          method: 'POST', headers: hdrs,
          body: JSON.stringify({
            name: 'ble_tenant_id', protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-attribute-mapper',
            config: {
              'user.attribute': 'ble_tenant_id', 'claim.name': 'ble_tenant_id',
              'jsonType.label': 'String', 'id.token.claim': 'true',
              'access.token.claim': 'true', 'userinfo.token.claim': 'true',
              'multivalued': 'false', 'aggregate.attrs': 'false',
            },
          }),
        })
        console.log('[global-setup] Created ble_tenant_id protocol mapper on ble-identity')
      }
    }
  }

  console.log(`[global-setup] KC users synced with ble_tenant_id=${tenantId}`)
}

export default async function globalSetup() {
  console.log('[global-setup] Ensuring seed data (tenant + territory)...')

  try {
    const seed = await ensureSeedData()
    process.env.DEV_TENANT_ID = seed.tenantId
    process.env.DEV_TERRITORY_ID = seed.territoryId
    console.log(`[global-setup] Tenant: ${seed.tenantId} (${seed.tenantName})`)
    console.log(`[global-setup] Territory: ${seed.territoryId} (${seed.territoryName})`)

    // Sync Keycloak users so JWT contains the correct ble_tenant_id claim
    await syncKeycloakUsers(seed.tenantId)

    // Write to a temp file for cross-process sharing
    const fs = await import('fs')
    const path = await import('path')
    const dir = './test-results'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, '.seed-data.json'),
      JSON.stringify(seed, null, 2),
    )
  } catch (e) {
    console.error('[global-setup] Seed data creation failed:', e)
    console.error('[global-setup] CRUD tests that require seed data will be skipped.')
  }
}
