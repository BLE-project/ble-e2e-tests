/**
 * Seed dispatcher — re-seed a specific data group on demand.
 *
 * The sequential Maestro suite mutates shared backend state: the moderation
 * flows consume queue rows, adv-takedown takes an APPROVED ADV down. Re-running
 * the owning seed right before each data-dependent flow keeps every flow's
 * precondition fresh, so a full sequential run is deterministic instead of
 * order-dependent (FU-TI-2 / FU-TI-4).
 *
 *   BFF_URL=http://localhost:8082 npx tsx fixtures/seed-cli.ts <group>
 *
 * Groups:
 *   moderation     — budget-degraded no-verdict ADV + topped-up review queue
 *   merchant-adv   — dev-merchant APPROVED + REJECTED ADVs (takedown/appeal)
 *   tenant-beacon  — free a beacon CRUD slot for tenant/beacons
 */
import { ensureBudgetDegradedAdv } from './seed-budget-degraded'
import { ensureModerationQueue } from './seed-moderation-queue'
import { ensureMerchantAdvData } from './seed-merchant-adv'
import { ensureTenantBeaconCrudSlotFree } from './seed-tenant-beacon-crud'

const GROUPS: Record<string, () => Promise<void>> = {
  moderation: async () => {
    const bd = await ensureBudgetDegradedAdv()
    console.log(`[seed-cli] budget-degraded ADV: ${bd.advId} (created=${bd.created})`)
    const mq = await ensureModerationQueue()
    console.log(`[seed-cli] moderation queue: ${mq.advs.length} actionable rows`)
  },
  'merchant-adv': async () => {
    // ensureMerchantAdvData resolves dev-merchant internally; the arg is unused.
    const ma = await ensureMerchantAdvData('')
    console.log(`[seed-cli] merchant ADV: approved=${ma.approved} rejected=${ma.rejected}`)
  },
  'tenant-beacon': async () => {
    const freed = await ensureTenantBeaconCrudSlotFree()
    console.log(`[seed-cli] tenant beacon slot freed: ${freed}`)
  },
}

const group = process.argv[2]
const run = group ? GROUPS[group] : undefined
if (!run) {
  console.error(`[seed-cli] unknown group "${group ?? ''}". Known: ${Object.keys(GROUPS).join(', ')}`)
  process.exit(2)
}
run()
  .then(() => process.exit(0))
  .catch((err) => { console.error(`[seed-cli] ${group} FAILED:`, err); process.exit(1) })
