/**
 * Playwright global setup — runs ONCE before all tests.
 * Creates a tenant + territory in the database so CRUD tests
 * have valid data for dropdown selects and relationships.
 *
 * The created IDs are stored in environment variables so tests
 * can access them via process.env.
 */
import { ensureSeedData } from './fixtures/seed-data'

export default async function globalSetup() {
  console.log('[global-setup] Ensuring seed data (tenant + territory)...')

  try {
    const seed = await ensureSeedData()
    // Export to env so all test workers can access
    process.env.DEV_TENANT_ID = seed.tenantId
    process.env.DEV_TERRITORY_ID = seed.territoryId
    console.log(`[global-setup] Tenant: ${seed.tenantId} (${seed.tenantName})`)
    console.log(`[global-setup] Territory: ${seed.territoryId} (${seed.territoryName})`)

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
