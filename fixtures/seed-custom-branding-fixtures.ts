/**
 * Fase 4.1: Custom-branding seed fixtures.
 *
 * Purpose:
 *   Configure a *visibly distinctive* branding record on the E2E tenant
 *   so both the Maestro flow `custom-branding.yaml` and the consumer-
 *   mobile BrandingContext integration can prove that:
 *
 *     1. The BFF's /bff/v1/consumer/brand endpoint returns the custom
 *        primaryColor (and NOT the platform default #6C3FCF).
 *     2. On tenant context switch, BrandingProvider re-fetches and the
 *        app retheems in a single render cycle (FEAT-BRAND-001).
 *
 * Why a fixture (and not fixed DB rows):
 *   The branding row is mutated by the admin console in real runs, so
 *   the E2E fixture is re-applied idempotently on every seed to keep
 *   the "custom" state deterministic — even if a previous test edited
 *   the colors, this fixture snaps them back to the canonical values.
 *
 * What it creates / ensures:
 *   - Tenant "E2E Dev Tenant" (via ensureSeedData — reused if present)
 *   - A branding row attached to that tenant with:
 *       primaryColor:    #FF6B9D   (hot pink — obviously NOT default)
 *       secondaryColor:  #1E90FF   (dodger blue)
 *       accentColor:     #FFD93D   (canary yellow)
 *       backgroundColor: #FFF5F9   (soft pink tint)
 *       textColor:       #1A1A2E   (near-black for contrast)
 *       appNameOverride: "E2E Brand"
 *       currency:        EUR
 *       defaultLocale:   it
 *       walletLabel:     "Portafoglio E2E"
 *       earnLabel:       "Guadagna E2E"
 *       spendLabel:      "Spendi E2E"
 *
 * Usage from Playwright / scripts:
 *   import { ensureCustomBrandingFixtures } from './seed-custom-branding-fixtures'
 *   const f = await ensureCustomBrandingFixtures()
 *   // f.tenantId / f.branding.primaryColor / ...
 *
 * Usage from CLI (one-shot local seeding):
 *   npx tsx fixtures/seed-custom-branding-fixtures.ts
 */
import { ensureSeedData } from './seed-data'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

// ── Canonical custom-branding payload ──────────────────────────────────────
//
// These colors are intentionally chosen to be obviously different from
// PLATFORM_DEFAULT_BRANDING (#6C3FCF) in every channel, so:
//   - Visual inspection during Maestro runs can confirm the theme applied.
//   - Automated assertions can simply compare the hex strings and not
//     worry about HSL ambiguity.
export const CUSTOM_BRANDING_PAYLOAD = {
  primaryColor:    '#FF6B9D',
  secondaryColor:  '#1E90FF',
  accentColor:     '#FFD93D',
  backgroundColor: '#FFF5F9',
  textColor:       '#1A1A2E',
  mapMarkerColor:  '#FF6B9D',
  appNameOverride: 'E2E Brand',
  defaultLocale:   'it',
  currency:        'EUR',
  walletLabel:     'Portafoglio E2E',
  earnLabel:       'Guadagna E2E',
  spendLabel:      'Spendi E2E',
} as const

export interface CustomBrandingFixtures {
  token:    string
  tenantId: string
  branding: typeof CUSTOM_BRANDING_PAYLOAD
}

let _cache: CustomBrandingFixtures | null = null

/**
 * Idempotently ensure the custom-branding row is attached to the E2E
 * tenant. Results cached for the lifetime of the Node process.
 *
 * The PUT /api/v1/tenants/{tenantId}/branding endpoint has PATCH
 * semantics (only non-null fields apply), so repeated calls with the
 * same payload are safe — the server just re-applies the fields.
 */
export async function ensureCustomBrandingFixtures(): Promise<CustomBrandingFixtures> {
  if (_cache) return _cache

  const base = await ensureSeedData()
  const { token, tenantId } = base

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  }

  // PUT /api/v1/tenants/{tenantId}/branding
  // (gateway transparent proxy strips /api/v1 and forwards to core-registry)
  const url = `${BFF_URL}/api/v1/tenants/${tenantId}/branding`
  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(CUSTOM_BRANDING_PAYLOAD),
  })
  if (!putRes.ok) {
    throw new Error(
      `PUT branding for tenant ${tenantId} failed: ${putRes.status} ${await putRes.text()}`,
    )
  }

  _cache = {
    token,
    tenantId,
    branding: CUSTOM_BRANDING_PAYLOAD,
  }
  return _cache
}

/**
 * Reset the cache — useful if a test deliberately mutates branding and
 * wants the next fixture call to re-apply from scratch.
 */
export function resetCustomBrandingCache(): void {
  _cache = null
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
//
// Support `npx tsx fixtures/seed-custom-branding-fixtures.ts` so a dev
// can prime the local DB without running the full Playwright suite.

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /seed-custom-branding-fixtures\.(ts|js)$/.test(process.argv[1])

if (isDirectRun) {
  ensureCustomBrandingFixtures()
    .then(f => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(f, null, 2))
      process.exit(0)
    })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error('[seed-custom-branding] FAILED:', err)
      process.exit(1)
    })
}
