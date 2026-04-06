import { test, expect } from '@playwright/test'
import { loginViaApi, DEV_TENANT_ID } from '../../fixtures/auth'
import { ApiClient } from '../../helpers/api-client'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const STORAGE_KEY = 'ble_tenant_token'

let territoryId: string | null = null

test.describe('Tenant Web - Stores', () => {
  // Ensure a territory exists for the select dropdown
  test.beforeAll(async ({ request }) => {
    const client = new ApiClient(request, BFF_URL)
    await client.login(TENANT_USER, TENANT_PASS)

    // Try to create a territory for the dev tenant
    const createRes = await client.post(
      '/api/v1/territories',
      { name: `E2E Territory ${Date.now()}`, tenantId: DEV_TENANT_ID },
      { 'X-Tenant-Id': DEV_TENANT_ID },
    )
    if (createRes.ok()) {
      const body = await createRes.json()
      territoryId = body.id
    } else {
      // Territory creation may fail if one already exists — try listing
      const listRes = await client.get('/api/v1/territories', { 'X-Tenant-Id': DEV_TENANT_ID })
      if (listRes.ok()) {
        const territories = await listRes.json()
        if (Array.isArray(territories) && territories.length > 0) {
          territoryId = territories[0].id
        }
      }
    }
  })

  test.afterAll(async ({ request }) => {
    // Clean up the territory we created (if we created one)
    if (territoryId) {
      const client = new ApiClient(request, BFF_URL)
      await client.login(TENANT_USER, TENANT_PASS)
      await client.delete(`/api/v1/territories/${territoryId}`, { 'X-Tenant-Id': DEV_TENANT_ID }).catch(() => {})
    }
  })

  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
  })

  test('stores list page loads', async ({ page }) => {
    // Page heading is "Store" (Italian)
    const heading = page.getByRole('heading', { name: /store/i })
    const emptyState = page.getByText(/nessun store/i)
    const table = page.locator('table')
    const list = page.locator('[data-testid*="store"], [class*="store"]')
    await expect(heading.or(emptyState).or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new store', async ({ page }) => {
    const storeName = `E2E Store ${Date.now()}`

    // Click "+ Nuovo store" button
    await page.getByRole('button', { name: /Nuovo store/i }).click()

    // Fill "Nome store *" — find the label text and get the sibling input
    const nameInput = page.locator('label:has-text("Nome store") + input, label:has-text("Nome store") ~ input')
      .or(page.locator('label').filter({ hasText: 'Nome store' }).locator('..').locator('input'))
    if (await nameInput.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nameInput.first().fill(storeName)
    } else {
      // Fallback: fill the first visible text input in the form
      const formInput = page.locator('form input[type="text"]').first()
      await formInput.fill(storeName)
    }

    // Territory is a required select — pick the first option if available
    const territorySelect = page.locator('form select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const options = territorySelect.locator('option')
      const optionCount = await options.count()
      if (optionCount > 1) {
        // Select the first non-empty option
        await territorySelect.selectOption({ index: 1 })
      }
    }

    // Submit with "Crea store" button
    await page.getByRole('button', { name: /Crea store/i }).click()
    await page.waitForLoadState('networkidle')

    // Wait briefly for mutation to complete
    await page.waitForTimeout(1_000)

    // Verify it appears
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(storeName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete (uses window.confirm with "Elimina" button)
    page.on('dialog', dialog => dialog.accept())
    const deleteBtn = page.getByText(storeName).locator('..').locator('..').getByRole('button', { name: 'Elimina' })
      .or(page.getByText(storeName).locator('..').getByRole('button', { name: 'Elimina' }))
    if (await deleteBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.first().click()
      await page.waitForLoadState('networkidle')
    }
  })

  test('add a zone to a store', async ({ page }) => {
    const storeName = `E2E Zone Store ${Date.now()}`
    const zoneName = `Zone ${Date.now()}`

    // Create a store first
    await page.getByRole('button', { name: /Nuovo store/i }).click()
    const formInput = page.locator('form input[required]').first()
      .or(page.locator('form input[type="text"]').first())
    await formInput.first().fill(storeName)

    const territorySelect = page.locator('form select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const optionCount = await territorySelect.locator('option').count()
      if (optionCount > 1) await territorySelect.selectOption({ index: 1 })
    }
    await page.getByRole('button', { name: /Crea store/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Navigate back and expand zones
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')

    // Click "Zone" button on the store to expand zone panel
    const storeCard = page.getByText(storeName).locator('..').locator('..')
    const zoneBtn = storeCard.getByRole('button', { name: 'Zone' })
    await expect(zoneBtn).toBeVisible({ timeout: 5_000 })
    await zoneBtn.click()

    // Wait for zone panel to appear
    await expect(page.getByText('Zone in questo store')).toBeVisible({ timeout: 5_000 })

    // Fill zone name input (placeholder "Nome zona")
    await page.getByPlaceholder('Nome zona').fill(zoneName)

    // Click "+ Zona" button to add the zone
    await page.getByRole('button', { name: '+ Zona' }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Verify zone appears
    await expect(page.getByText(zoneName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete store
    page.on('dialog', dialog => dialog.accept())
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    const cleanup = page.getByText(storeName).locator('..').locator('..')
    const deleteBtn = cleanup.getByRole('button', { name: 'Elimina' })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForLoadState('networkidle')
    }
  })

  test.fixme('delete a zone from a store' /* FIX: zone row selector */, async ({ page }) => {
    const storeName = `E2E DelZone ${Date.now()}`
    const zoneName = `Zone Del ${Date.now()}`

    // Create a store
    await page.getByRole('button', { name: /Nuovo store/i }).click()
    const formInput = page.locator('form input[required]').first()
      .or(page.locator('form input[type="text"]').first())
    await formInput.first().fill(storeName)

    const territorySelect = page.locator('form select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const optionCount = await territorySelect.locator('option').count()
      if (optionCount > 1) await territorySelect.selectOption({ index: 1 })
    }
    await page.getByRole('button', { name: /Crea store/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Expand zones
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    const storeCard = page.getByText(storeName).locator('..').locator('..')
    await storeCard.getByRole('button', { name: 'Zone' }).click()
    await expect(page.getByText('Zone in questo store')).toBeVisible({ timeout: 5_000 })

    // Add a zone
    await page.getByPlaceholder('Nome zona').fill(zoneName)
    await page.getByRole('button', { name: '+ Zona' }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)
    await expect(page.getByText(zoneName)).toBeVisible({ timeout: 10_000 })

    // Delete the zone — each zone has an inline "Elimina" text button
    const zoneRow = page.getByText(zoneName).locator('..')
    const deleteZoneBtn = zoneRow.getByText('Elimina')
    await deleteZoneBtn.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Verify zone is removed
    await expect(page.getByText(zoneName)).not.toBeVisible({ timeout: 10_000 })

    // Cleanup: delete store
    page.on('dialog', dialog => dialog.accept())
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    const cleanup = page.getByText(storeName).locator('..').locator('..')
    const deleteStoreBtn = cleanup.getByRole('button', { name: 'Elimina' })
    if (await deleteStoreBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteStoreBtn.click()
      await page.waitForLoadState('networkidle')
    }
  })

  test('delete a store', async ({ page }) => {
    const storeName = `E2E Delete Store ${Date.now()}`

    // Create
    await page.getByRole('button', { name: /Nuovo store/i }).click()
    const formInput = page.locator('form input[required]').first()
      .or(page.locator('form input[type="text"]').first())
    await formInput.first().fill(storeName)

    const territorySelect = page.locator('form select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const optionCount = await territorySelect.locator('option').count()
      if (optionCount > 1) await territorySelect.selectOption({ index: 1 })
    }
    await page.getByRole('button', { name: /Crea store/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Delete — button "Elimina" on the store card (uses window.confirm)
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')

    page.on('dialog', dialog => dialog.accept())
    const storeCard = page.getByText(storeName).locator('..').locator('..')
    await storeCard.getByRole('button', { name: 'Elimina' }).click()
    await page.waitForLoadState('networkidle')

    // Verify removed
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(storeName)).not.toBeVisible({ timeout: 10_000 })
  })
})
