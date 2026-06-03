/**
 * T-162 L7 — Seed dev-sales-agent with a territory assignment.
 *
 * <p>Required for T-162 beacon-health alert fan-out: the notification-service
 * BeaconHealthAlertDispatcher looks up sales_agent_device_token rows by
 * territory_id. Without an assignment row in core-registry, the sales-agent
 * mobile app calls /v1/sales-agents/me and gets territoryIds=[], so the
 * pushTokenRegistration POSTs with empty array → no fan-out.
 *
 * <p>This fixture:
 *   1. Logs in as SUPER_ADMIN
 *   2. Finds dev-sales-agent's SalesAgent row
 *   3. Ensures an assignment (tenantId=E2E, territoryId=E2E) exists
 *   4. Idempotent — skips if already assigned
 *
 * <p>Run: `npx tsx fixtures/seed-sales-agent-territory.ts`
 */
import { ensureSeedData } from './seed-data'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const CORE_URL = process.env.CORE_URL ?? 'http://localhost:8082'

interface SalesAgentMe {
  id: string
  email: string
  keycloakUserId: string
  territoryIds?: string[]
  tenantIds?: string[]
}

async function salesAgentLogin(): Promise<string> {
  const res = await fetch(`${BFF_URL}/api/v1/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username: 'dev-sales-agent', password: 'dev-pass' }),
  })
  if (!res.ok) throw new Error(`sales-agent login failed: ${res.status} ${await res.text()}`)
  const { token } = (await res.json()) as { token: string }
  return token
}

async function fetchSalesAgentMe(token: string): Promise<SalesAgentMe> {
  // /v1/* requires X-Tenant-Id; derive it from the JWT ble_tenant_id claim so
  // the gateway TenantContextFilter doesn't 400.
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { tenant_id?: string; ble_tenant_id?: string }
  const tenantId = claims.tenant_id ?? claims.ble_tenant_id ?? ''
  const res = await fetch(`${BFF_URL}/api/v1/sales-agents/me`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId },
  })
  if (!res.ok) throw new Error(`/me failed: ${res.status} ${await res.text()}`)
  return res.json()
}

/** Decode a claim from a JWT (base64url payload). */
function claim(token: string, key: string): string | undefined {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>
  const v = payload[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * Ensure dev-sales-agent has a SalesAgent profile row. The mobile app's
 * /v1/sales-agents/me 404s (AGENT_NOT_FOUND) until one exists, blocking the
 * merchant/beacon onboarding screens. Creates it via the SUPER_ADMIN-only
 * POST /v1/sales-agents, keyed on the agent's Keycloak sub. Idempotent: if /me
 * already resolves, returns that id.
 */
async function ensureSalesAgentProfile(
  adminToken: string,
  saToken: string,
  tenantId: string,
): Promise<string> {
  try {
    const me = await fetchSalesAgentMe(saToken)
    console.log(`[seed] sales-agent profile present: id=${me.id} email=${me.email}`)
    return me.id
  } catch (e) {
    if (!String((e as Error).message).includes('404')) throw e
    // 404 AGENT_NOT_FOUND → create the profile.
  }

  // /v1/sales-agents/me looks the profile up by SecurityContext principal name,
  // which (per the OIDC principal-claim config) is `preferred_username`, NOT the
  // `sub` UUID — the 404 message "for user: dev-sales-agent" is the lookup key.
  // Key the profile on preferred_username so /me resolves; fall back to sub.
  const keycloakUserId = claim(saToken, 'preferred_username') ?? claim(saToken, 'sub')
  const email = claim(saToken, 'email') ?? 'dev-sales-agent@ble.local'
  if (!keycloakUserId) throw new Error('cannot resolve sales-agent principal from token')

  const res = await fetch(`${BFF_URL}/api/v1/sales-agents`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${adminToken}`,
      'X-Tenant-Id':  tenantId,
    },
    body: JSON.stringify({
      keycloakUserId,
      email,
      firstName: claim(saToken, 'given_name') ?? 'Dev',
      lastName:  claim(saToken, 'family_name') ?? 'SalesAgent',
      fiscalType: 'INDIVIDUAL',
    }),
  })
  if (!res.ok) {
    throw new Error(`create sales-agent profile failed: ${res.status} ${await res.text()}`)
  }
  const created = (await res.json()) as { id: string }
  console.log(`[seed] created sales-agent profile: id=${created.id} kc=${keycloakUserId}`)
  return created.id
}

async function ensureAssignment(
  adminToken: string,
  agentId: string,
  tenantId: string,
  territoryId: string,
): Promise<boolean> {
  // List existing (via BFF /api/v1 — core-registry has no host port).
  const existingRes = await fetch(
    `${BFF_URL}/api/v1/sales-agents/${agentId}/assignments`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Tenant-Id': tenantId,
      },
    },
  )
  if (!existingRes.ok) {
    throw new Error(`list assignments failed: ${existingRes.status}`)
  }
  const existing = (await existingRes.json()) as Array<{
    tenantId: string
    territoryId?: string
  }>
  const already = existing.some(
    (a) => a.tenantId === tenantId && a.territoryId === territoryId,
  )
  if (already) {
    console.log(`[seed] assignment already present: agent=${agentId} territory=${territoryId}`)
    return false
  }

  // Create new
  const postRes = await fetch(
    `${BFF_URL}/api/v1/sales-agents/${agentId}/assignments`,
    {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${adminToken}`,
        'X-Tenant-Id':  tenantId,
      },
      body: JSON.stringify({ tenantId, territoryId }),
    },
  )
  if (!postRes.ok) {
    throw new Error(`POST assignment failed: ${postRes.status} ${await postRes.text()}`)
  }
  console.log(`[seed] created assignment: agent=${agentId} territory=${territoryId}`)
  return true
}

export async function ensureSalesAgentTerritory(): Promise<{
  agentId: string
  tenantId: string
  territoryId: string
  created: boolean
}> {
  const base = await ensureSeedData()
  const { token: adminToken, territoryId } = base

  // The assignment + profile must live on the sales-agent's OWN tenant (the
  // gateway cross-checks X-Tenant-Id against the agent's claim for /me reads).
  const saToken = await salesAgentLogin()
  const tenantId = claim(saToken, 'ble_tenant_id') ?? claim(saToken, 'tenant_id') ?? base.tenantId

  const agentId = await ensureSalesAgentProfile(adminToken, saToken, tenantId)
  const created = await ensureAssignment(adminToken, agentId, tenantId, territoryId)
  return { agentId, tenantId, territoryId, created }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────
const isDirect = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && /seed-sales-agent-territory\.(ts|js)$/.test(process.argv[1])

if (isDirect) {
  ensureSalesAgentTerritory()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(r, null, 2))
      process.exit(0)
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed-sales-agent-territory] FAILED:', err)
      process.exit(1)
    })
}
