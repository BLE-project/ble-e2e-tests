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
  const res = await fetch(`${BFF_URL}/api/v1/sales-agents/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`/me failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function ensureAssignment(
  adminToken: string,
  agentId: string,
  tenantId: string,
  territoryId: string,
): Promise<boolean> {
  // List existing
  const existingRes = await fetch(
    `${CORE_URL}/v1/sales-agents/${agentId}/assignments`,
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
    `${CORE_URL}/v1/sales-agents/${agentId}/assignments`,
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
  const { token: adminToken, tenantId, territoryId } = base

  // sales-agent /me to get the agent row id
  const saToken = await salesAgentLogin()
  const me = await fetchSalesAgentMe(saToken)
  console.log(`[seed] sales-agent me.id=${me.id} email=${me.email}`)

  const created = await ensureAssignment(adminToken, me.id, tenantId, territoryId)
  return { agentId: me.id, tenantId, territoryId, created }
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
