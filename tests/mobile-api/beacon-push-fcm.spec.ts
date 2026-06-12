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
const WIREMOCK = process.env.WIREMOCK_URL ?? 'http://localhost:8091'
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

    // login consumer A — tenant risolto dal claim JWT (deve essere un UUID:
    // event-ingestion rifiuta claim non-UUID come il wildcard "ANY")
    consumerToken = await loginAs(request, CONSUMER_USER)
    const claims = jwtClaims(consumerToken)
    consumerId = String(claims.preferred_username ?? CONSUMER_USER)
    tenantA = String(claims.tenant_id ?? '')
    expect(tenantA, `dev-consumer tenant_id claim must be a UUID (got "${tenantA}")`)
      .toMatch(/^[0-9a-f-]{36}$/i)
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

  test('Step 4: consent revoked — no push', async () => {
    // SKIP documentato: nello stack e2e il consent-check del notification-service
    // è disabilitato (CONSENT_CHECK_ENABLED=false in terrio-e2e-compose) perché
    // il default %prod punta a http://ble-identity-access:8080 (alias inesistente
    // qui) e soprattutto DefaultConsentChecker chiama
    //   GET /v1/consents?consumerId=…&consentType=MARKETING   (senza Authorization)
    // mentre identity-access espone
    //   GET /v1/consents/{consumerId}                          (role-gated TENANT_ADMIN/SUPER_ADMIN)
    // → contratto disallineato: con il check attivo OGNI push verrebbe soppressa
    // (fail-closed SEC-011), quindi il caso "consent revocato → nessun push" non è
    // esercitabile e2e via API. Il gate consenso è coperto dagli unit test del
    // notification-service (DispatchOrchestrator + DefaultConsentChecker).
    test.skip(true, 'consent-check disabilitato in e2e: contratto DefaultConsentChecker ↔ identity-access disallineato (vedi commento)')
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
