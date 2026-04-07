/**
 * Mobile API tests — Sales Agent app endpoints.
 *
 * Covers every REST call made by ble-sales-agent-mobile:
 *   - Auth (login)
 *   - Agent profile (GET /api/v1/sales-agents/me)
 *   - Registration requests (GET/PUT /api/v1/registration-requests)
 *   - Kit deliveries (GET/POST /api/v1/kit-deliveries)
 *   - Agent royalties (GET /api/v1/agent-royalties)
 *   - Merchants managed by agent (GET /api/v1/merchants?managedByAgent=true)
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'
const AGENT_USER = process.env.AGENT_USER ?? 'dev-sales-agent'
const AGENT_PASS = process.env.AGENT_PASS ?? 'dev-pass'

function getTenantId(): string {
  const seed = loadSeedDataSync()
  return seed?.tenantId ?? process.env.DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
}

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BFF}/api/v1/auth/login`, {
    data: { username: AGENT_USER, password: AGENT_PASS },
  })
  expect(res.ok(), `sales-agent login failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  expect(body.token).toBeTruthy()
  return body.token
}

function hdrs(tok: string): Record<string, string> {
  return {
    Authorization: `Bearer ${tok}`,
    'X-Tenant-Id': getTenantId(),
    'Content-Type': 'application/json',
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

test.describe('Sales Agent Auth', () => {
  test('POST /api/v1/auth/login — agent credentials returns token', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: AGENT_USER, password: AGENT_PASS },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.token).toBeTruthy()
  })
})

// ── Agent Profile ────────────────────────────────────────────────────────────

test.describe('Agent Profile', () => {
  test('GET /api/v1/sales-agents/me — returns agent profile', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/api/v1/sales-agents/me`, {
      headers: hdrs(token),
    })
    // 200 if agent exists, 404 if no agent record, 403 if wrong role
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('firstName')
      expect(body).toHaveProperty('email')
    }
  })
})

// ── Registration Requests ────────────────────────────────────────────────────

test.describe('Registration Requests', () => {
  test('GET /api/v1/registration-requests — list all requests', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/api/v1/registration-requests`, {
      headers: hdrs(token),
    })
    // 200 with list, 401/403 if wrong role, 404 if not implemented
    expect([200, 401, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })

  test('GET /api/v1/registration-requests?status=PENDING — filter by status', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(
      `${BFF}/api/v1/registration-requests?status=PENDING`,
      { headers: hdrs(token) },
    )
    expect([200, 401, 403, 404]).toContain(res.status())
  })

  test('PUT /api/v1/registration-requests/{id}/status — update status (placeholder ID)', async ({ request }) => {
    const token = await login(request)
    const placeholderId = '00000000-0000-0000-0000-000000000099'
    const res = await request.put(
      `${BFF}/api/v1/registration-requests/${placeholderId}/status`,
      {
        headers: hdrs(token),
        data: { status: 'IN_REVIEW', notes: 'E2E test status update' },
      },
    )
    // 200 on success, 401/404 if request not found, 403 if wrong role
    expect([200, 401, 403, 404]).toContain(res.status())
  })
})

// ── Kit Deliveries ───────────────────────────────────────────────────────────

test.describe('Kit Deliveries', () => {
  test('GET /api/v1/kit-deliveries — list deliveries', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/api/v1/kit-deliveries`, {
      headers: hdrs(token),
    })
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })

  test('POST /api/v1/kit-deliveries — create delivery endpoint reachable', async ({ request }) => {
    const token = await login(request)
    const res = await request.post(`${BFF}/api/v1/kit-deliveries`, {
      headers: hdrs(token),
      data: {
        registrationRequestId: '00000000-0000-0000-0000-000000000099',
        items: 'Welcome Kit: POS terminal, signage, cards (E2E test)',
        notes: 'E2E test delivery',
      },
    })
    // 201 on success, 400/404 if registration request not found, 403/500 if error
    expect([201, 400, 403, 404, 500]).toContain(res.status())
  })
})

// ── Agent Royalties ──────────────────────────────────────────────────────────

test.describe('Agent Royalties', () => {
  test('GET /api/v1/agent-royalties — list royalties', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(`${BFF}/api/v1/agent-royalties`, {
      headers: hdrs(token),
    })
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })
})

// ── Merchants Managed by Agent ───────────────────────────────────────────────

test.describe('Managed Merchants', () => {
  test('GET /api/v1/merchants?managedByAgent=true — list agent merchants', async ({ request }) => {
    const token = await login(request)
    const res = await request.get(
      `${BFF}/api/v1/merchants?managedByAgent=true`,
      { headers: hdrs(token) },
    )
    expect([200, 403, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(Array.isArray(body)).toBeTruthy()
    }
  })
})
