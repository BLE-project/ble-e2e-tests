/**
 * Run the complete base seed (the Playwright global-setup) as a standalone CLI.
 *
 * The Maestro CI suite has no Playwright runner to trigger global-setup, so it
 * invokes this wrapper once after the compose stack is up: it creates the seed
 * tenant + territory, syncs the Keycloak dev users' tenant/merchant claims, and
 * lays down every fixture (moderation queue, merchant ADVs, branding, …). The
 * per-flow seed-cli re-seeds refresh the consumable subset on top.
 *
 *   BFF_URL=http://localhost:8082 npm run seed
 */
import globalSetup from '../global-setup'

globalSetup()
  .then(() => { console.log('[seed-all] base seed complete'); process.exit(0) })
  .catch((err) => { console.error('[seed-all] FAILED:', err); process.exit(1) })
