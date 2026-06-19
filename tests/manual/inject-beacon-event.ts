/**
 * Manual helper — inject ONE beacon event into the live e2e pipeline so that it
 * produces a REAL FCM push to dev-consumer's physically registered device.
 *
 * This is a local, throwaway helper (NOT part of the Playwright suite). It
 * reuses exactly the working sequence from
 *   tests/mobile-api/beacon-push-fcm.spec.ts
 * (login → grant MARKETING consent → ensure a censused beacon → POST event),
 * but targets the REAL FCM stack instead of the WireMock stub:
 *
 *   docker-compose.override.yml pins notification-service to
 *     FCM_API_BASE_URL=https://fcm.googleapis.com, FCM_PROJECT_ID=terrionotification,
 *     FCM_SERVICE_ACCOUNT_JSON=/run/secrets/real-fcm-sa.json
 *   and dev-consumer's real device token is already in consumer_device_token
 *   (consumer_id="dev-consumer", tenant 7d224640-fe1a-4748-8fcb-e27b9a984ac2).
 *
 * Because the device token is already registered, this helper does NOT register
 * a push token and does NOT assert against WireMock. Instead it polls the
 * notification-service container logs for the INFO dispatch line emitted by
 * DispatchOrchestrator:
 *
 *     NOTIFY [PUSH] tenant=... consumer=dev-consumer rule=... detail=PUSH/ACCEPTED: ...
 *
 * `PUSH/ACCEPTED` == FcmPushSender got HTTP 200 from the real Google FCM v1 API.
 * `PUSH/GATEWAY_ERROR: HTTP <code>: <body>` == FCM rejected the send.
 * A WARN `Consent not granted for consumer=dev-consumer` == consent gate blocked.
 *
 * Pipeline: POST /api/v1/events (BFF → event-ingestion) → event_outbox →
 * Kafka ble.raw.events.v1 → stream-processing (enrich) → ble.enriched-events.v1
 * → BeaconEventDispatcher → DispatchOrchestrator (rule + consent + cap) →
 * FcmPushSender → POST https://fcm.googleapis.com/v1/.../messages:send.
 *
 * Usage:
 *   source ~/.nvm/nvm.sh && nvm use 22 && \
 *   npx tsx tests/manual/inject-beacon-event.ts [--silent-poll]
 *
 * --silent-poll : skip the ~60s log poll (use when you watch the physical device).
 */

const BFF = process.env.BFF_URL ?? 'http://localhost:8082'
const KEYCLOAK = process.env.KEYCLOAK_URL ?? process.env.KC_URL ?? 'http://localhost:8180'

const CONSUMER_USER = process.env.CONSUMER_USER ?? 'dev-consumer'
const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const PASSWORD = process.env.DEV_PASS ?? process.env.CONSUMER_PASS ?? 'dev-pass'

const NOTIF_CONTAINER = process.env.NOTIF_CONTAINER ?? 'terrio-e2e-notification-service-1'

/** Holy-IOT H-02 (Cassa Bar) — censused MERCHANT beacon, factory UUID. */
const BEACON_UUID = process.env.BEACON_UUID ?? 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825'
const BEACON_MAJOR = Number(process.env.BEACON_MAJOR ?? 1)
const BEACON_MINOR = Number(process.env.BEACON_MINOR ?? 102)
const BEACON_TYPE = 'MERCHANT'

const CONSENT_VERSION = 'v1.0'
const SILENT_POLL = process.argv.includes('--silent-poll')

/**
 * --direct-enriched : bypass ingestion + stream-processing and publish ONE
 * well-formed EnrichedBeaconEvent straight onto ble.enriched-events.v1, so we
 * verify ONLY the notification→FCM segment (what PR #95 changed). Use when the
 * raw→enriched leg is broken/drifted (e.g. ClickHouse `ble_events` missing or
 * the FU-34 audit 22P02 noise) but enrichment itself is irrelevant to the test.
 */
const DIRECT_ENRICHED = process.argv.includes('--direct-enriched')

/** Kafka topic the notification-service BeaconEventDispatcher consumes. */
const ENRICHED_TOPIC = process.env.ENRICHED_TOPIC ?? 'ble.enriched-events.v1'
/** Redpanda container — we produce via `rpk` inside it to dodge the
 *  advertised-listener problem (broker advertises redpanda:9092, unreachable
 *  from the host). NOT the host:9092 mapping. */
const REDPANDA_CONTAINER = process.env.REDPANDA_CONTAINER ?? 'terrio-e2e-redpanda-1'

/** A valid territoryId of the device tenant (ble_core.territories — Ter2 E2E Dev). */
const TERRITORY_ID = process.env.TERRITORY_ID ?? '8112bd70-1a4d-465c-89a3-c5168ce02f56'

/**
 * Optional REAL FCM device token for the physical device. The beacon dispatcher
 * resolves push targets by (tenantId, consumerId) from consumer_device_token;
 * if no token row exists the event is dropped as `no_tokens` BEFORE consent/FCM.
 * Provide the token from the device's FCM SDK to register it (idempotent) so the
 * push actually reaches FCM. Without it, --direct-enriched will still publish but
 * dispatch ends at no_tokens.
 */
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? ''
const DEVICE_PLATFORM = process.env.DEVICE_PLATFORM ?? 'android'

const ts = () => new Date().toISOString().replace('T', ' ').replace('Z', '')
function log(step: string, msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] [${step}] ${msg}`)
}
function fail(step: string, msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[${ts()}] [${step}] FAILED: ${msg}`)
  process.exit(1)
}

function jwtClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

async function login(username: string): Promise<string> {
  const res = await fetch(`${BFF}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  if (!res.ok) fail('login', `login as ${username} → ${res.status} ${await res.text().catch(() => '')}`)
  const body = (await res.json()) as { token?: string }
  if (!body.token) fail('login', `login as ${username}: no token in response`)
  return body.token
}

function hdrs(token: string, tenant: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': tenant,
    'Content-Type': 'application/json',
  }
}

/** Idempotent upsert of MARKETING consent (BFF proxies to identity-access). */
async function grantMarketingConsent(token: string, tenant: string, consumer: string): Promise<void> {
  const res = await fetch(`${BFF}/api/v1/consents`, {
    method: 'POST',
    headers: hdrs(token, tenant),
    body: JSON.stringify({
      consumerId: consumer,
      consentType: 'MARKETING',
      granted: true,
      version: CONSENT_VERSION,
    }),
  })
  if (res.status !== 200) {
    fail('consent', `MARKETING consent upsert → ${res.status} ${await res.text().catch(() => '')}`)
  }
  const body = (await res.json()) as { consentType?: string; granted?: boolean }
  if (body.consentType !== 'MARKETING' || body.granted !== true) {
    fail('consent', `unexpected consent body: ${JSON.stringify(body)}`)
  }
}

/** Ensure the beacon (uuid, major, minor) is censused for the tenant. Idempotent. */
async function ensureBeacon(adminToken: string, tenant: string): Promise<void> {
  const listRes = await fetch(`${BFF}/api/v1/beacons`, { headers: hdrs(adminToken, tenant) })
  if (!listRes.ok) fail('beacon', `GET /beacons → ${listRes.status} ${await listRes.text().catch(() => '')}`)
  const beacons = (await listRes.json()) as Array<{ ibeaconUuid: string; major: number; minor: number }>
  const found = beacons.find(
    b =>
      b.ibeaconUuid?.toUpperCase() === BEACON_UUID.toUpperCase() &&
      b.major === BEACON_MAJOR &&
      b.minor === BEACON_MINOR,
  )
  if (found) {
    log('beacon', `already censused: ${BEACON_UUID} major=${BEACON_MAJOR} minor=${BEACON_MINOR}`)
    return
  }
  log('beacon', `not found — creating ${BEACON_UUID} major=${BEACON_MAJOR} minor=${BEACON_MINOR}`)
  const createRes = await fetch(`${BFF}/api/v1/beacons`, {
    method: 'POST',
    headers: hdrs(adminToken, tenant),
    body: JSON.stringify({
      ibeaconUuid: BEACON_UUID,
      major: BEACON_MAJOR,
      minor: BEACON_MINOR,
      type: BEACON_TYPE,
      name: `manual-inject ${BEACON_MAJOR}/${BEACON_MINOR}`,
    }),
  })
  if (![201, 409].includes(createRes.status)) {
    fail('beacon', `create beacon → ${createRes.status} ${await createRes.text().catch(() => '')}`)
  }
  log('beacon', `create → ${createRes.status}`)
}

/** EventIngestRequest body (event-ingestion). */
function beaconEvent(consumer: string) {
  return {
    deviceId: 'manual-inject-device',
    consumerId: consumer,
    beaconUuid: BEACON_UUID,
    beaconMajor: BEACON_MAJOR,
    beaconMinor: BEACON_MINOR,
    beaconType: BEACON_TYPE,
    rssi: -55,
    txPower: -59,
    ts: new Date().toISOString(),
    nonce: `manual-inject-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  }
}

/**
 * Well-formed EnrichedBeaconEvent for ble.enriched-events.v1 — field names/types
 * mirror EXACTLY terrio-stream-processing EnrichedEvent.java (Jackson record
 * serialisation) so notification-service EnrichedBeaconEvent deserialises it.
 * fraudFlagged=false (STR-005: fraud events are never pushed).
 */
function enrichedBeaconEvent(consumer: string, tenant: string) {
  const nowIso = new Date().toISOString()
  return {
    eventId: cryptoRandomUuid(),
    idempotencyKey: `direct-enriched-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    tenantId: tenant,
    territoryId: TERRITORY_ID,
    consumerId: consumer,
    deviceId: 'manual-inject-device',
    beaconUuid: BEACON_UUID,
    beaconMajor: BEACON_MAJOR,
    beaconMinor: BEACON_MINOR,
    beaconType: BEACON_TYPE,
    rssi: -55,
    txPower: -59,
    batteryLevel: 0.9,
    ts: nowIso,
    receivedAt: nowIso,
    computedDistanceMeters: 0.69,
    proximityZone: 'IMMEDIATE',
    qualityScore: 0.45,
    enrichedAt: nowIso,
    fraudFlagged: false,
    fraudScore: 0.0,
    fraudSignals: [] as unknown[],
  }
}

function cryptoRandomUuid(): string {
  return (require('crypto') as typeof import('crypto')).randomUUID()
}

/**
 * Publishes ONE message onto the enriched topic via `rpk topic produce` inside
 * the redpanda container. Using docker exec (not a host kafkajs client) sidesteps
 * the advertised-listener mismatch: the broker advertises redpanda:9092, which is
 * not resolvable from the host. Resolves with the rpk stdout/stderr.
 */
function produceEnriched(json: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process')
    // -i keeps stdin open for rpk; one JSON record (single-line) → one message.
    const child = spawn(
      'docker',
      ['exec', '-i', REDPANDA_CONTAINER, 'rpk', 'topic', 'produce', ENRICHED_TOPIC],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let out = ''
    let errOut = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (errOut += d.toString()))
    child.on('error', (e: Error) => reject(e))
    child.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(`rpk produce exit=${code}: ${errOut || out}`))
        return
      }
      // rpk prints "Produced to partition N at offset M ..." on success.
      if (!/Produced to partition/i.test(out + errOut)) {
        reject(new Error(`rpk produce gave no confirmation: ${out}${errOut}`))
        return
      }
      log('direct', out.trim() || errOut.trim())
      resolve()
    })
    // Single-line JSON + trailing newline → exactly one record.
    child.stdin.write(json.replace(/\n/g, ' ') + '\n')
    child.stdin.end()
  })
}

/**
 * Idempotently registers a REAL device push token for (tenant, consumer) so the
 * beacon dispatcher can resolve a target. Same BFF endpoint the spec uses. No-op
 * when DEVICE_TOKEN is unset (caller is relying on a pre-registered token).
 */
async function ensureDeviceToken(token: string, tenant: string): Promise<void> {
  if (!DEVICE_TOKEN) return
  const res = await fetch(`${BFF}/bff/v1/consumer/push-token`, {
    method: 'POST',
    headers: hdrs(token, tenant),
    body: JSON.stringify({
      pushToken: DEVICE_TOKEN,
      platform: DEVICE_PLATFORM,
      appVersion: '1.0.0',
      deviceModel: 'manual-direct-enriched',
    }),
  })
  if (res.status !== 204) {
    fail('device-token', `push-token registration → ${res.status} ${await res.text().catch(() => '')}`)
  }
  log('device-token', `registered real device token (${DEVICE_PLATFORM}) for direct-enriched`)
}

/** Read notification-service container logs since `sinceIso`. */
function notifLogsSince(sinceIso: string): Promise<string> {
  return new Promise(resolve => {
    const { execFile } = require('child_process') as typeof import('child_process')
    execFile(
      'docker',
      ['logs', '--since', sinceIso, NOTIF_CONTAINER],
      { maxBuffer: 64 * 1024 * 1024 },
      (_err: unknown, stdout: string, stderr: string) => resolve(`${stdout ?? ''}${stderr ?? ''}`),
    )
  })
}

interface DispatchOutcome {
  dispatched: boolean
  fcm: string // 'accepted' | 'error:...' | 'consent-denied' | 'pending'
  line: string
}

/**
 * Poll notification-service logs for the dispatch outcome for our consumer.
 * Looks for the DispatchOrchestrator INFO line:
 *   NOTIFY [PUSH] ... consumer=<consumer> ... detail=PUSH/<STATUS>: ...
 * and for the consent-denied WARN. Returns once a terminal signal is seen or
 * the timeout elapses.
 */
async function pollDispatch(consumer: string, sinceIso: string, timeoutMs: number): Promise<DispatchOutcome> {
  const deadline = Date.now() + timeoutMs
  const notifyRe = new RegExp(
    `NOTIFY \\[PUSH\\][^\\n]*consumer=${consumer}\\b[^\\n]*detail=PUSH/([A-Z_]+):?([^\\n]*)`,
  )
  const consentRe = new RegExp(`Consent not granted for consumer=${consumer}\\b`)
  const fcmErrRe = /FCM v1 push (failed|error|interrupted)[^\n]*/
  for (;;) {
    const logs = await notifLogsSince(sinceIso)
    const m = logs.match(notifyRe)
    if (m) {
      const status = m[1]
      const detail = (m[2] ?? '').trim()
      if (status === 'ACCEPTED') {
        return { dispatched: true, fcm: 'accepted', line: m[0].trim() }
      }
      return { dispatched: true, fcm: `error:${status}${detail ? ' ' + detail : ''}`.trim(), line: m[0].trim() }
    }
    if (consentRe.test(logs)) {
      return { dispatched: false, fcm: 'consent-denied', line: (logs.match(consentRe) ?? [''])[0] }
    }
    const fe = logs.match(fcmErrRe)
    if (fe) {
      return { dispatched: false, fcm: `error:${fe[0]}`, line: fe[0] }
    }
    if (Date.now() > deadline) {
      return { dispatched: false, fcm: 'pending', line: '(no NOTIFY [PUSH] line within timeout)' }
    }
    await new Promise(r => setTimeout(r, 3000))
  }
}

async function main() {
  log('config', `BFF=${BFF} KC=${KEYCLOAK} notif=${NOTIF_CONTAINER} silentPoll=${SILENT_POLL}`)

  // 1. Login dev-consumer → access token + resolve tenant from JWT claim.
  const consumerToken = await login(CONSUMER_USER)
  const claims = jwtClaims(consumerToken)
  const consumerId = String(claims.preferred_username ?? CONSUMER_USER)
  const tenant = String(claims.tenant_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(tenant)) {
    fail('login', `dev-consumer tenant_id claim is not a UUID: "${tenant}"`)
  }
  log('login', `consumer=${consumerId} tenant=${tenant}`)

  const adminToken = await login(TENANT_USER)
  log('login', `tenant-admin token acquired (${TENANT_USER})`)

  // 2. Ensure MARKETING consent granted (consent gate is fail-closed/active).
  //    Required in BOTH modes — the consent gate lives inside DispatchOrchestrator.
  await grantMarketingConsent(consumerToken, tenant, consumerId)
  log('consent', `MARKETING consent granted for ${consumerId}`)

  // ── Mode B: --direct-enriched ─────────────────────────────────────────────
  // Skip ingestion + stream-processing entirely; publish a well-formed
  // EnrichedBeaconEvent straight onto ble.enriched-events.v1.
  if (DIRECT_ENRICHED) {
    await ensureDeviceToken(consumerToken, tenant)
    const enriched = enrichedBeaconEvent(consumerId, tenant)
    const sinceIso = new Date(Date.now() - 2000).toISOString()
    log('direct', `publishing EnrichedBeaconEvent eventId=${enriched.eventId} → ${ENRICHED_TOPIC}`)
    await produceEnriched(JSON.stringify(enriched))
    log('direct', `produced to ${ENRICHED_TOPIC} via ${REDPANDA_CONTAINER}`)

    const beaconLabel = `${BEACON_UUID}/${BEACON_MAJOR}/${BEACON_MINOR}`
    if (SILENT_POLL) {
      log('poll', '--silent-poll set: skipping log poll (watch the device).')
      // eslint-disable-next-line no-console
      console.log(`RESULT: dispatched=unknown beacon=${beaconLabel} fcm=skipped-poll mode=direct-enriched`)
      return
    }
    log('poll', 'polling notification-service logs for dispatch outcome (~60s)…')
    const outcome = await pollDispatch(consumerId, sinceIso, 60_000)
    log('poll', `dispatch line: ${outcome.line}`)
    // eslint-disable-next-line no-console
    console.log(`RESULT: dispatched=${outcome.dispatched} beacon=${beaconLabel} fcm=${outcome.fcm} mode=direct-enriched`)
    if (!outcome.dispatched) process.exit(2)
    return
  }

  // ── Mode A: full pipeline (default) ───────────────────────────────────────
  // 3. Ensure a censused, resolvable beacon.
  await ensureBeacon(adminToken, tenant)
  log('beacon', `using uuid=${BEACON_UUID} major=${BEACON_MAJOR} minor=${BEACON_MINOR} type=${BEACON_TYPE}`)

  // Capture the log cursor just before injecting, so the poll only sees this run.
  const sinceIso = new Date(Date.now() - 2000).toISOString()

  // 4. POST the beacon event (same endpoint/headers as the spec).
  const event = beaconEvent(consumerId)
  const evRes = await fetch(`${BFF}/api/v1/events`, {
    method: 'POST',
    headers: { ...hdrs(consumerToken, tenant), 'X-Consent-State': 'granted' },
    body: JSON.stringify(event),
  })
  if (evRes.status !== 202) {
    fail('event', `POST /api/v1/events → ${evRes.status} ${await evRes.text().catch(() => '')}`)
  }
  const ingest = (await evRes.json()) as { status?: string }
  log('event', `ingested → 202 status=${ingest.status} nonce=${event.nonce}`)
  if (ingest.status === 'DUPLICATE') {
    log('event', 'WARNING: ingestion reported DUPLICATE (nonce/dedup) — push may be suppressed')
  }

  const beaconLabel = `${BEACON_UUID}/${BEACON_MAJOR}/${BEACON_MINOR}`

  // 5. Poll for the dispatch outcome.
  if (SILENT_POLL) {
    log('poll', '--silent-poll set: skipping log poll (watch the device).')
    // eslint-disable-next-line no-console
    console.log(`RESULT: dispatched=unknown beacon=${beaconLabel} fcm=skipped-poll`)
    return
  }

  log('poll', 'polling notification-service logs for dispatch outcome (~60s)…')
  const outcome = await pollDispatch(consumerId, sinceIso, 60_000)
  log('poll', `dispatch line: ${outcome.line}`)

  // eslint-disable-next-line no-console
  console.log(`RESULT: dispatched=${outcome.dispatched} beacon=${beaconLabel} fcm=${outcome.fcm}`)
  if (!outcome.dispatched) process.exit(2)
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(`[${ts()}] [fatal] ${err?.stack ?? err}`)
  process.exit(1)
})
