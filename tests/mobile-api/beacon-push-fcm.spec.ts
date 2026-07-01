/**
 * Mobile API — beacon → FCM push pipeline (cross-service, FCM-E2E).
 *
 * Verifica end-to-end la pipeline chiusa da ble-notification-service#91:
 *
 *   POST /api/v1/events (BFF → event-ingestion, JWT tenant_id + X-Consent-State)
 *     → event_outbox → Kafka ble.raw.events.v1
 *     → stream-processing (enrichment) → ble.enriched-events.v1
 *     → BeaconEventDispatcher → DispatchOrchestrator (regole + consent + cap)
 *     → FcmPushSender → POST {FCM_API_BASE_URL}/v1/projects/terrio-e2e/messages:send
 *
 * In e2e l'endpoint FCM è uno stub WireMock (terrio-e2e-compose):
 *   - token OAuth2: POST /oauth2/token → "fake-e2e-token" (token_uri del fake SA)
 *   - send:         POST /v1/projects/terrio-e2e/messages:send → 200
 * Le asserzioni leggono il request journal admin di WireMock (host :8091).
 *
 * Precondizioni (terrio-e2e-compose, branch feat/fcm-stub-e2e):
 *   - notification-service con NOTIFICATION_BEACON_DISPATCH_ENABLED=true,
 *     FCM_PROJECT_ID=terrio-e2e, FCM_API_BASE_URL=http://wiremock:8091,
 *     FCM_SERVICE_ACCOUNT_JSON=/run/secrets/fake-fcm-sa.json (make fcm-sa)
 *   - event-ingestion / stream-processing con TERRIO_CONSUMER_ID_MASTER_SALT
 *   - ble-notification-service#93: CONSENT_CHECK_ENABLED=true (fail-closed
 *     SEC-011) + CONSENT_S2S_CLIENT_SECRET — il gate consenso MARKETING è
 *     ATTIVO: lo spec concede il consenso in setup (obbligatorio per l'happy
 *     path) e lo Step 4 esercita revoca → nessun push → ri-concessione → push.
 *
 * NOTA consumerId: il device token è registrato dal BFF con il principal name
 * del JWT (preferred_username, es. "dev-consumer"); l'EnrichedEvent porta il
 * consumerId fornito nel body dell'evento. I due devono coincidere perché
 * BeaconEventDispatcher risolva i token con lookup (tenantId, consumerId).
 *
 * NOTA payload FCM: JsonUtils.buildFcmV1Payload produce
 *   {message:{token, notification:{title,body}, android:{priority:"HIGH"}}}
 * — nessun campo `data` (asseriamo token + title/body + android.priority).
 */
import { test, expect, APIRequestContext } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF      = process.env.BFF_URL      ?? 'http://localhost:8080'
// WIREMOCK_URL belongs to Docker-internal service configuration
// (http://wiremock:8091). Tests run on the host/network namespace and need the
// published admin endpoint instead, so keep a distinct variable.
const WIREMOCK = process.env.WIREMOCK_ADMIN_URL ?? 'http://localhost:8091'
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8180'

const KC_ADMIN_USER = process.env.KEYCLOAK_ADMIN      ?? 'admin'
const KC_ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASS ?? 'admin'

const CONSUMER_USER = process.env.CONSUMER_USER ?? 'dev-consumer'
const TENANT_USER   = process.env.TENANT_USER   ?? 'dev-tenant-admin'
const PASSWORD      = process.env.DEV_PASS      ?? 'dev-pass'

/** Consumer "tenant B" creato ad-hoc in Keycloak per il caso cross-tenant. */
const EVENTER_B_USER = 'e2e-fcm-eventer-b'
/** Tenant B fittizio: NON deve coincidere col tenant del consumer A. */
const TENANT_B = 'b0000000-0000-4000-8000-0000000000b2'

const FCM_SEND_PATH = '/v1/projects/terrio-e2e/messages:send'

/** Push token unico per run — l'assert su WireMock cerca esattamente questo. */
const PUSH_TOKEN = `e2e-fcm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const RULE_NAME    = 'e2e-beacon-push-fcm'
const BEACON_UUID  = 'e2efc100-0000-4000-8000-0000000000fc'
const BEACON_MAJOR = 200
const BEACON_MINOR = Math.floor(Math.random() * 9000) + 1000

// Stato condiviso fra gli step (describe.serial)
let tenantA = ''
let territoryId: string | null = null
let consumerToken = ''
let consumerId = ''          // principal name del consumer (preferred_username)
let tenantAdminToken = ''

// ── Helpers ──────────────────────────────────────────────────────────────────

function jwtClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

async function loginAs(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.post(`${BFF}/api/v1/auth/login`, {
    data: { username, password: PASSWORD },
  })
  expect(res.ok(), `login as ${username} failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  expect(body.token).toBeTruthy()
  return body.token
}

function hdrs(token: string, tenant: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': tenant,
    'Content-Type': 'application/json',
  }
}

/** Richieste FCM messages:send nel journal WireMock il cui body contiene `needle`. */
async function fcmSendRequests(request: APIRequestContext, needle: string): Promise<string[]> {
  const res = await request.post(`${WIREMOCK}/__admin/requests/find`, {
    data: { method: 'POST', urlPath: FCM_SEND_PATH },
  })
  expect(res.ok(), `wiremock find failed: ${res.status()}`).toBeTruthy()
  const found = await res.json() as { requests?: Array<{ body?: string }> }
  return (found.requests ?? [])
    .map(r => r.body ?? '')
    .filter(b => b.includes(needle))
}

/** Poll del journal finché compare una messages:send col token, o timeout. */
async function waitForFcmSend(
  request: APIRequestContext, needle: string, timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const bodies = await fcmSendRequests(request, needle)
    if (bodies.length > 0) return bodies
    if (Date.now() > deadline) return []
    await new Promise(r => setTimeout(r, 3000))
  }
}

/**
 * ble-notification-service#93 — consenso MARKETING del consumer.
 *
 * Il BFF proxa /api/v1/consents* su identity-access (TransparentProxyResource).
 * L'upsert è idempotente sulla chiave (consumerId, tenant, type, version):
 * ri-concedere dopo una revoca riattiva lo stesso record (revokedAt → null).
 * DispatchOrchestrator interroga GET /v1/consents/{consumerId} via il service
 * account S2S CONSENT_READ con X-Tenant-Id = tenant dell'evento, quindi il
 * record va scritto per (consumerId del payload evento, tenantA).
 */
const CONSENT_VERSION = 'v1.0'

async function upsertMarketingConsent(
  request: APIRequestContext, token: string, tenant: string,
  consumer: string, granted: boolean,
): Promise<void> {
  const res = await request.post(`${BFF}/api/v1/consents`, {
    headers: hdrs(token, tenant),
    data: {
      consumerId: consumer,
      consentType: 'MARKETING',
      granted,
      version: CONSENT_VERSION,
    },
  })
  expect(res.status(), `consent upsert (granted=${granted}) failed: ${res.status()}`).toBe(200)
  const body = await res.json() as { consentType: string; granted: boolean }
  expect(body.consentType).toBe('MARKETING')
  expect(body.granted).toBe(granted)
}

async function revokeMarketingConsent(
  request: APIRequestContext, token: string, tenant: string, consumer: string,
): Promise<void> {
  const res = await request.post(
    `${BFF}/api/v1/consents/${encodeURIComponent(consumer)}/revoke`,
    {
      headers: hdrs(token, tenant),
      data: { consentType: 'MARKETING' },
    },
  )
  // 204 anche quando non c'è nulla da revocare (revoke idempotente, SEC-FIX-003)
  expect(res.status(), `consent revoke failed: ${res.status()}`).toBe(204)
}

/** Evento BLE conforme a EventIngestRequest (event-ingestion). */
function beaconEvent(consumer: string, deviceId: string) {
  return {
    deviceId,
    consumerId: consumer,
    beaconUuid: BEACON_UUID,
    beaconMajor: BEACON_MAJOR,
    beaconMinor: BEACON_MINOR,
    beaconType: 'MERCHANT',
    rssi: -55,
    txPower: -59,
    ts: new Date().toISOString(),
    nonce: `fcm-spec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  }
}

// ── Keycloak admin: utente consumer "tenant B" (idempotente) ─────────────────

async function keycloakAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(
    `${KEYCLOAK}/realms/master/protocol/openid-connect/token`,
    {
      form: {
        client_id: 'admin-cli',
        grant_type: 'password',
        username: KC_ADMIN_USER,
        password: KC_ADMIN_PASS,
      },
    },
  )
  expect(res.ok(), `keycloak admin token failed: ${res.status()}`).toBeTruthy()
  return (await res.json() as { access_token: string }).access_token
}

/**
 * Crea (o riallinea) un utente CONSUMER nel realm ble con claim tenant_id
 * concreto — serve perché event-ingestion risolve il tenant SOLO dal claim
 * JWT (UUID obbligatorio) e il caso cross-tenant richiede un tenant ≠ A.
 */
async function ensureConsumerUser(
  request: APIRequestContext, username: string, tenantId: string,
): Promise<void> {
  const admin = await keycloakAdminToken(request)
  const auth = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }
  const base = `${KEYCLOAK}/admin/realms/ble`

  // find-or-create
  const lookup = await request.get(`${base}/users?username=${username}&exact=true`, { headers: auth })
  expect(lookup.ok()).toBeTruthy()
  let users = await lookup.json() as Array<{ id: string }>

  if (users.length === 0) {
    const created = await request.post(`${base}/users`, {
      headers: auth,
      data: {
        username,
        enabled: true,
        emailVerified: true,
        email: `${username}@ble.local`,
        attributes: { ble_tenant_id: [tenantId] },
        credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
      },
    })
    expect([201, 409]).toContain(created.status())
    const again = await request.get(`${base}/users?username=${username}&exact=true`, { headers: auth })
    users = await again.json() as Array<{ id: string }>
  }
  expect(users.length).toBeGreaterThan(0)
  const userId = users[0].id

  // riallinea attributo tenant + credenziali (idempotente fra run)
  const upd = await request.put(`${base}/users/${userId}`, {
    headers: auth,
    data: {
      enabled: true,
      emailVerified: true,
      attributes: { ble_tenant_id: [tenantId] },
    },
  })
  expect([204]).toContain(upd.status())
  const pwd = await request.put(`${base}/users/${userId}/reset-password`, {
    headers: auth,
    data: { type: 'password', value: PASSWORD, temporary: false },
  })
  expect([204]).toContain(pwd.status())

  // realm role CONSUMER (no-op se già assegnato)
  const roleRes = await request.get(`${base}/roles/CONSUMER`, { headers: auth })
  expect(roleRes.ok()).toBeTruthy()
  const role = await roleRes.json() as { id: string; name: string }
  const map = await request.post(`${base}/users/${userId}/role-mappings/realm`, {
    headers: auth,
    data: [{ id: role.id, name: role.name }],
  })
  expect([204]).toContain(map.status())
}

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe.serial('Beacon → FCM push pipeline (WireMock stub)', () => {
  // pipeline Kafka multi-hop: timeout generoso
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    // 4. pulizia journal WireMock a inizio spec (il journal accumula run precedenti)
    const wipe = await request.delete(`${WIREMOCK}/__admin/requests`)
    expect(wipe.ok(), 'wiremock journal reset failed').toBeTruthy()

    // Federated consumers deliberately carry tenant_id=ANY. Resolve the active
    // E2E tenant from the canonical seed and pass it explicitly in X-Tenant-Id.
    consumerToken = await loginAs(request, CONSUMER_USER)
    const claims = jwtClaims(consumerToken)
    consumerId = String(claims.preferred_username ?? CONSUMER_USER)
    expect(String(claims.tenant_id ?? claims.ble_tenant_id ?? '')).toBe('ANY')
    tenantA = loadSeedDataSync()?.tenantId ?? ''
    expect(tenantA).toMatch(/^[0-9a-f-]{36}$/i)
    expect(tenantA).not.toBe(TENANT_B)

    tenantAdminToken = await loginAs(request, TENANT_USER)

    territoryId = loadSeedDataSync()?.territoryId ?? null
  })

  test('Setup: ensure beacon registered for tenant A', async ({ request }) => {
    // Il dispatch path non consulta il beacon registry, ma il flusso reale
    // prevede beacon censiti: riusa il pattern di beacon-notification.spec.ts.
    const res = await request.post(`${BFF}/api/v1/beacons`, {
      headers: hdrs(tenantAdminToken, tenantA),
      data: {
        uuid: BEACON_UUID,
        major: BEACON_MAJOR,
        minor: BEACON_MINOR,
        beaconType: 'MERCHANT',
        label: `E2E FCM beacon ${BEACON_MINOR}`,
        ...(territoryId ? { territoryId } : {}),
      },
    })
    // 201 creato, 409 residuo di run precedente, 400 se la validazione
    // territorio non passa (non load-bearing per la pipeline push)
    expect([201, 400, 409]).toContain(res.status())
  })

  test('Setup: ensure active PUSH notification rule for tenant A', async ({ request }) => {
    // DispatchOrchestrator richiede ≥1 regola attiva (tenant, channel=PUSH),
    // altrimenti NO_RULE e nessuna delivery.
    const list = await request.get(`${BFF}/api/v1/notification-rules`, {
      headers: hdrs(tenantAdminToken, tenantA),
    })
    expect(list.status(), 'GET /notification-rules failed').toBe(200)
    const rules = await list.json() as Array<{ name: string; channel: string; active: boolean }>
    const existing = rules.find(r => r.channel === 'PUSH' && r.active && r.name === RULE_NAME)
    if (!existing) {
      const created = await request.post(`${BFF}/api/v1/notification-rules`, {
        headers: hdrs(tenantAdminToken, tenantA),
        // minIntervalSecs 0 → nessun frequency cap fra run ripetute
        data: { name: RULE_NAME, channel: 'PUSH', minIntervalSecs: 0 },
      })
      expect(created.status(), 'create PUSH rule failed').toBe(201)
    }
  })

  test('Setup: grant MARKETING consent for consumer A', async ({ request }) => {
    // ble-notification-service#93: con CONSENT_CHECK_ENABLED=true (fail-closed
    // SEC-011) il dispatch verifica il consenso MARKETING su identity-access.
    // Senza questo record l'happy path (Step 2) verrebbe soppresso.
    await upsertMarketingConsent(request, consumerToken, tenantA, consumerId, true)
  })

  test('Step 1: register device push token via BFF', async ({ request }) => {
    const res = await request.post(`${BFF}/bff/v1/consumer/push-token`, {
      headers: hdrs(consumerToken, tenantA),
      data: {
        pushToken: PUSH_TOKEN,
        platform: 'android',
        appVersion: '1.0.0',
        deviceModel: 'e2e-fcm-spec',
      },
    })
    expect(res.status(), `push-token registration failed: ${res.status()}`).toBe(204)
  })

  test('Step 2: happy path — beacon event triggers FCM messages:send with the token', async ({ request }) => {
    const res = await request.post(`${BFF}/api/v1/events`, {
      headers: {
        ...hdrs(consumerToken, tenantA),
        'X-Consent-State': 'granted',          // gate ADR-004 D5 su event-ingestion
      },
      data: beaconEvent(consumerId, 'e2e-fcm-device-happy'),
    })
    expect(res.status(), `event ingest failed: ${res.status()}`).toBe(202)
    const ingest = await res.json() as { status: string }
    expect(ingest.status).toBe('RECEIVED')      // DUPLICATE = nonce/dedup problema

    // outbox(2s tick) → Kafka → enrichment → Kafka → dispatch → FCM: ~10-60s
    const bodies = await waitForFcmSend(request, PUSH_TOKEN, 90_000)
    expect(bodies.length, 'no FCM messages:send with our push token within 90s').toBeGreaterThan(0)

    const payload = JSON.parse(bodies[0]) as {
      message: {
        token: string
        notification?: { title?: string; body?: string }
        android?: { priority?: string }
        data?: Record<string, string>
      }
    }
    expect(payload.message.token).toBe(PUSH_TOKEN)
    expect(payload.message.notification?.title?.length ?? 0).toBeGreaterThan(0)
    expect(payload.message.notification?.body?.length ?? 0).toBeGreaterThan(0)
    // il payload v1 corrente non include `data` (JsonUtils.buildFcmV1Payload):
    // asseriamo la sezione android presente in sua vece
    expect(payload.message.android?.priority).toBe('HIGH')
  })

  test('Step 2b: GAP-025 — the delivered push persists to the consumer inbox + mark-read round-trip', async ({ request }) => {
    // Step 2 delivered a PUSH for (tenantA, consumerId); DispatchOrchestrator.persistInbox
    // writes one inbox row per delivered PUSH. This is the second half of GAP-025 that
    // used to be uncovered: persist → GET (via BFF → notification-service) → mark-read → GET.
    // Tolerates both payload shapes ({ notifications } envelope or a bare [] legacy body).
    const rowsOf = (b: unknown): Array<Record<string, unknown>> =>
      Array.isArray(b) ? b : ((b as { notifications?: unknown[] })?.notifications as never) ?? []

    const listRes = await request.get(`${BFF}/bff/v1/consumer/notifications`, {
      headers: hdrs(consumerToken, tenantA),
    })
    expect(listRes.status(), `inbox GET failed: ${listRes.status()}`).toBe(200)
    const rows = rowsOf(await listRes.json())
    expect(rows.length, 'a delivered PUSH must persist an inbox row (GAP-025)').toBeGreaterThan(0)

    const row = rows[0]
    const id = String(row.id)
    expect(id, 'inbox row must carry an id').toBeTruthy()
    expect(String(row.title ?? '').length, 'inbox row must carry a title').toBeGreaterThan(0)
    expect(row.readAt ?? null, 'a fresh inbox row must be unread').toBeNull()

    // mark it read — the BFF exposes PUT and translates it to the backend POST .../read
    const markRes = await request.put(`${BFF}/bff/v1/consumer/notifications/${id}/read`, {
      headers: hdrs(consumerToken, tenantA),
    })
    expect([200, 204], `mark-read failed: ${markRes.status()}`).toContain(markRes.status())

    // GET again → the same row now reports a non-null readAt
    const afterRes = await request.get(`${BFF}/bff/v1/consumer/notifications`, {
      headers: hdrs(consumerToken, tenantA),
    })
    expect(afterRes.status()).toBe(200)
    const marked = rowsOf(await afterRes.json()).find((n) => String(n.id) === id)
    expect(marked, 'the row must still be present after mark-read').toBeTruthy()
    expect(marked?.readAt ?? null, 'readAt must be set after mark-read').not.toBeNull()
  })

  test('Step 3: cross-tenant — event under tenant B must NOT push tenant-A token', async ({ request }) => {
    // Utente CONSUMER con claim tenant_id = TENANT_B (ingestion risolve il
    // tenant SOLO dal claim): stesso consumerId nel body, tenant diverso.
    await ensureConsumerUser(request, EVENTER_B_USER, TENANT_B)
    const eventerBToken = await loginAs(request, EVENTER_B_USER)
    expect(String(jwtClaims(eventerBToken).tenant_id)).toBe(TENANT_B)

    const before = (await fcmSendRequests(request, PUSH_TOKEN)).length
    expect(before, 'expected the happy-path send in the journal').toBeGreaterThan(0)

    const res = await request.post(`${BFF}/api/v1/events`, {
      headers: {
        ...hdrs(eventerBToken, TENANT_B),
        'X-Consent-State': 'granted',
      },
      data: beaconEvent(consumerId, 'e2e-fcm-device-crosstenant'),
    })
    expect(res.status(), `tenant-B event ingest failed: ${res.status()}`).toBe(202)

    // Finestra di attesa: la pipeline impiega ~10s nel caso positivo; 30s
    // bastano per escludere un push tardivo. Poi verifica negativa.
    await new Promise(r => setTimeout(r, 30_000))
    const after = (await fcmSendRequests(request, PUSH_TOKEN)).length
    expect(after, 'cross-tenant event must not produce a push for the tenant-A token').toBe(before)
  })

  test('Step 4: consent revoked — no push; re-granted — push resumes', async ({ request }) => {
    // ble-notification-service#93 CHIUSA: DefaultConsentChecker ora parla il
    // contratto reale di identity-access (GET /v1/consents/{consumerId} +
    // bearer S2S CONSENT_READ) e il check è ATTIVO in questo stack
    // (CONSENT_CHECK_ENABLED=true, fail-closed SEC-011) — il caso è
    // finalmente esercitabile e2e via API.

    // ── 4a. revoca il consenso MARKETING del consumer A ─────────────────────
    await revokeMarketingConsent(request, consumerToken, tenantA, consumerId)

    const before = (await fcmSendRequests(request, PUSH_TOKEN)).length
    expect(before, 'expected previous sends in the journal').toBeGreaterThan(0)

    // ── 4b. evento beacon con consenso revocato → NESSUN messages:send ──────
    const revokedRes = await request.post(`${BFF}/api/v1/events`, {
      headers: {
        ...hdrs(consumerToken, tenantA),
        'X-Consent-State': 'granted',   // gate ingestion: l'evento DEVE entrare
      },                                 // — il blocco atteso è a valle, al dispatch
      data: beaconEvent(consumerId, 'e2e-fcm-device-consent-revoked'),
    })
    expect(revokedRes.status(), `event ingest (revoked) failed: ${revokedRes.status()}`).toBe(202)

    // Finestra negativa: stessa ampiezza dello Step 3 (pipeline ~10s nel caso
    // positivo; 30s bastano per escludere un push tardivo).
    await new Promise(r => setTimeout(r, 30_000))
    const afterRevoked = (await fcmSendRequests(request, PUSH_TOKEN)).length
    expect(afterRevoked,
      'consent revoked: the event must NOT produce a messages:send (fail-closed gate)')
      .toBe(before)

    // ── 4c. ri-concedi il consenso → il push riprende ────────────────────────
    // Ripristina anche lo stato di baseline (consenso concesso) per idempotenza
    // fra run — l'upsert riattiva lo stesso record (stessa version).
    await upsertMarketingConsent(request, consumerToken, tenantA, consumerId, true)

    const regrantRes = await request.post(`${BFF}/api/v1/events`, {
      headers: {
        ...hdrs(consumerToken, tenantA),
        'X-Consent-State': 'granted',
      },
      data: beaconEvent(consumerId, 'e2e-fcm-device-consent-regranted'),
    })
    expect(regrantRes.status(), `event ingest (re-granted) failed: ${regrantRes.status()}`).toBe(202)

    const deadline = Date.now() + 90_000
    let afterRegrant = afterRevoked
    while (Date.now() < deadline) {
      afterRegrant = (await fcmSendRequests(request, PUSH_TOKEN)).length
      if (afterRegrant > afterRevoked) break
      await new Promise(r => setTimeout(r, 3000))
    }
    expect(afterRegrant,
      'consent re-granted: the event must produce a new messages:send within 90s')
      .toBeGreaterThan(afterRevoked)
  })

  test('Cleanup: unregister device token', async ({ request }) => {
    // Evita che le run future continuino a push-are token storici (ogni evento
    // farebbe N send, una per token residuo del consumer).
    const res = await request.delete(
      `${BFF}/api/v1/device-tokens/consumer/${encodeURIComponent(PUSH_TOKEN)}`,
      { headers: hdrs(consumerToken, tenantA) },
    )
    expect([200, 204]).toContain(res.status())
  })
})
