/**
 * Playwright global setup — runs ONCE before all tests.
 * Creates a tenant + territory in the database so CRUD tests
 * have valid data for dropdown selects and relationships.
 *
 * The created IDs are stored in environment variables so tests
 * can access them via process.env.
 */
import { ensureSeedData } from './fixtures/seed-data'
import { ensureBeaconFirstConfig } from './fixtures/seed-beacon-first-config'
import { ensureTenantBeaconCrudSlotFree } from './fixtures/seed-tenant-beacon-crud'
import { ensureBudgetDegradedAdv } from './fixtures/seed-budget-degraded'
import { ensureModerationQueue } from './fixtures/seed-moderation-queue'
import { ensureMerchantAdvData } from './fixtures/seed-merchant-adv'
import { ensureCustomBrandingFixtures } from './fixtures/seed-custom-branding-fixtures'

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

/**
 * Give dev-merchant a `ble_merchant_id` JWT claim so the merchant ADV UI works:
 * the notification-service resolves the owning merchant from this claim (GET
 * /v1/adv → 403 NO_MERCHANT_LINK without it; submit → 400 MERCHANT_ID_REQUIRED).
 * Mirrors the ble_tenant_id plumbing: profile-schema attribute + ble-identity
 * protocol mapper + per-user attribute value. Idempotent.
 */
async function ensureMerchantClaim(merchantId: string) {
  const tokenRes = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&client_id=admin-cli&username=admin&password=admin',
  })
  if (!tokenRes.ok) { console.warn('[global-setup] KC admin login failed (merchant claim)'); return }
  const { access_token: kcToken } = await tokenRes.json() as { access_token: string }
  const hdrs = { Authorization: `Bearer ${kcToken}`, 'Content-Type': 'application/json' }
  const base = `${KC_URL}/admin/realms/ble`

  // 1. profile-schema attribute
  const profileRes = await fetch(`${base}/users/profile`, { headers: hdrs })
  if (profileRes.ok) {
    const profile = await profileRes.json() as { attributes: Array<{ name: string }> }
    if (!profile.attributes.some(a => a.name === 'ble_merchant_id')) {
      profile.attributes.push({
        name: 'ble_merchant_id', displayName: 'BLE Merchant ID',
        permissions: { view: ['admin', 'user'], edit: ['admin'] },
        validations: {}, multivalued: false,
      } as any)
      await fetch(`${base}/users/profile`, { method: 'PUT', headers: hdrs, body: JSON.stringify(profile) })
      console.log('[global-setup] Added ble_merchant_id to KC user profile schema')
    }
  }

  // 2. ble-identity protocol mapper
  const clientsRes = await fetch(`${base}/clients?clientId=ble-identity`, { headers: hdrs })
  if (clientsRes.ok) {
    const clients = await clientsRes.json() as Array<{ id: string }>
    if (clients.length > 0) {
      const clientUuid = clients[0].id
      const mappersRes = await fetch(`${base}/clients/${clientUuid}/protocol-mappers/models`, { headers: hdrs })
      const mappers = mappersRes.ok ? await mappersRes.json() as Array<{ name: string }> : []
      if (!mappers.some(m => m.name === 'ble_merchant_id')) {
        await fetch(`${base}/clients/${clientUuid}/protocol-mappers/models`, {
          method: 'POST', headers: hdrs,
          body: JSON.stringify({
            name: 'ble_merchant_id', protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-attribute-mapper',
            config: {
              'user.attribute': 'ble_merchant_id', 'claim.name': 'ble_merchant_id',
              'jsonType.label': 'String', 'id.token.claim': 'true',
              'access.token.claim': 'true', 'userinfo.token.claim': 'true',
              'multivalued': 'false', 'aggregate.attrs': 'false',
            },
          }),
        })
        console.log('[global-setup] Created ble_merchant_id protocol mapper on ble-identity')
      }
    }
  }

  // 3. set the attribute on dev-merchant (spread the full rep so email/name are
  //    preserved; only the attributes map is augmented).
  const searchRes = await fetch(`${base}/users?username=dev-merchant&exact=true`, { headers: hdrs })
  if (searchRes.ok) {
    const found = await searchRes.json() as Array<{ id: string; attributes?: Record<string, string[]> }>
    if (found.length > 0) {
      const u = found[0]
      await fetch(`${base}/users/${u.id}`, {
        method: 'PUT', headers: hdrs,
        body: JSON.stringify({
          ...u,
          attributes: { ...(u.attributes ?? {}), ble_merchant_id: [merchantId] },
        }),
      })
      console.log(`[global-setup] dev-merchant ble_merchant_id=${merchantId}`)
    }
  }
}

/**
 * GAP-QA-009 (v7.9.17): retry seed data with exponential backoff.
 * Common transient failures: stack just started, BFF not yet healthy,
 * Keycloak Liquibase still running, etc. 5 retries × ~2s,4s,8s,16s,32s
 * = ~62s total window covers typical cold-boot scenario.
 */
async function ensureSeedDataWithRetry(maxAttempts = 5): Promise<Awaited<ReturnType<typeof ensureSeedData>>> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ensureSeedData()
    } catch (e) {
      lastErr = e
      if (attempt === maxAttempts) break
      const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 30_000)
      console.warn(`[global-setup] seed attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms: ${(e as Error).message?.slice(0, 120)}`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

export default async function globalSetup() {
  console.log('[global-setup] Ensuring seed data (tenant + territory)...')

  try {
    const seed = await ensureSeedDataWithRetry()
    process.env.DEV_TENANT_ID = seed.tenantId
    process.env.DEV_TERRITORY_ID = seed.territoryId
    console.log(`[global-setup] Tenant: ${seed.tenantId} (${seed.tenantName})`)
    console.log(`[global-setup] Territory: ${seed.territoryId} (${seed.territoryName})`)

    // Sync Keycloak users so JWT contains the correct ble_tenant_id claim
    await syncKeycloakUsers(seed.tenantId)

    // Seed the sales-agent first-config wizard data (SalesAgent profile +
    // territory assignment + merchant→agent + store(merchantId) + beacon→store)
    // so beacon-first-config.yaml has a merchant with a scannable beacon.
    // Best-effort: must run after the Keycloak claim sync (it logs in as
    // dev-sales-agent / dev-tenant-admin and needs the ble_tenant_id claim).
    let merchantId: string | undefined
    try {
      const fc = await ensureBeaconFirstConfig()
      merchantId = fc.merchantId
      console.log(`[global-setup] First-config seed: merchant=${fc.merchantId} store=${fc.storeId} beacon=${fc.beaconId}`)
    } catch (e) {
      console.warn('[global-setup] first-config seed skipped:', (e as Error).message)
    }

    // Free the tenant beacons CRUD slot (FDA50693/999/1) so beacons.yaml's
    // create runs fresh (the flow has no delete step → leftover would 409).
    try {
      const freed = await ensureTenantBeaconCrudSlotFree()
      console.log(`[global-setup] Tenant beacon CRUD slot: freed ${freed}`)
    } catch (e) {
      console.warn('[global-setup] tenant beacon CRUD cleanup skipped:', (e as Error).message)
    }

    // Seed a no-Claude-verdict ADV for moderation-budget-degraded.yaml: forces
    // the tenant to HUMAN_ONLY, submits one ADV (skips AI → no verdict), then
    // resets the budget to NORMAL so approve/reject ADVs still get a verdict.
    // Best-effort: a missing budget-degraded ADV only fails that single P2 flow.
    try {
      const bd = await ensureBudgetDegradedAdv()
      console.log(`[global-setup] Budget-degraded ADV: ${bd.advId} (created=${bd.created})`)
    } catch (e) {
      console.warn('[global-setup] budget-degraded seed skipped:', (e as Error).message)
    }

    // Top up the ADV moderation review queue so approve/reject/escalate (sales)
    // and tenant-review have actionable rows. Reconciles by queue STATE (not by
    // title) so repeated suite runs — which consume rows into terminal states —
    // stay green instead of poisoning the next run. Runs AFTER budget-degraded
    // so the tenant tier is back to NORMAL and the new ADVs get a Claude verdict.
    // Best-effort: a short queue only fails the moderation flows.
    try {
      const mq = await ensureModerationQueue()
      console.log(`[global-setup] Moderation queue: ${mq.advs.length} actionable rows`)
    } catch (e) {
      console.warn('[global-setup] moderation queue seed skipped:', (e as Error).message)
    }

    // Merchant ADV UI (adv-submit / adv-list-filter / adv-takedown / adv-appeal):
    // give dev-merchant a ble_merchant_id claim (the merchant from first-config)
    // so the ADV screen can list/submit, then seed dev-merchant-owned ADVs in
    // APPROVED + REJECTED so the takedown/appeal flows have a card to act on.
    if (merchantId) {
      try {
        await ensureMerchantClaim(merchantId)
        const ma = await ensureMerchantAdvData(merchantId)
        console.log(`[global-setup] Merchant ADV data: approved=${ma.approved} rejected=${ma.rejected}`)
      } catch (e) {
        console.warn('[global-setup] merchant ADV seed skipped:', (e as Error).message)
      }
    }

    // Custom-branding (custom-branding.yaml): set a distinctive tenant branding
    // (appNameOverride "E2E Brand") so the consumer Home renders the brand-tag.
    // Best-effort; uses a fresh tenant-admin token (avoids the long-run 401).
    try {
      const cb = await ensureCustomBrandingFixtures()
      console.log(`[global-setup] Custom branding: appName=${cb.branding.appNameOverride}`)
    } catch (e) {
      console.warn('[global-setup] custom-branding seed skipped:', (e as Error).message)
    }

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
    console.error('[global-setup] Seed data creation failed after retries:', e)
    console.error('[global-setup] CRUD tests that require seed data will be skipped.')
    // GAP-QA-009 (v7.9.17): write sentinel file so per-test fixtures can
    // distinguish "seed deliberately skipped" from "first run in progress"
    try {
      const fs = await import('fs')
      if (!fs.existsSync('./test-results')) fs.mkdirSync('./test-results', { recursive: true })
      fs.writeFileSync('./test-results/.seed-skipped.flag',
        `${new Date().toISOString()}\n${(e as Error).message}\n`)
    } catch { /* best-effort */ }
  }
}
