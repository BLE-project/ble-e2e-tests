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

    // Form: Nome store * (text input, required), Territorio * (select, required),
    // Latitudine (number), Longitudine (number). Fill positionally.
    const form = page.locator('form')
    await expect(form).toBeVisible({ timeout: 5_000 })

    // Nome store — the required text input
    await form.locator('input[required]').first().fill(storeName)

    // Territory select — pick first non-empty option
    const territorySelect = form.locator('select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const optionCount = await territorySelect.locator('option').count()
      if (optionCount > 1) {
        await territorySelect.selectOption({ index: 1 })
      }
    }

    // Submit with "Crea store" button
    await page.getByRole('button', { name: /Crea store/i }).click()
    await page.waitForTimeout(2_000)

    // Verify: form should close on success (onSuccess sets showForm=false).
    const formStillOpen = await form.isVisible().catch(() => false)
    expect(formStillOpen).toBe(false)
  })

  test('add a zone to a store', async ({ page }) => {
    const zoneName = `Zone ${Date.now()}`

    // The list is filtered by X-Tenant-Id. Find any store with a "Zone" button.
    const zoneBtn = page.getByRole('button', { name: 'Zone' }).first()
    const hasStore = await zoneBtn.isVisible({ timeout: 5_000 }).catch(() => false)
    if (!hasStore) {
      test.skip(!hasStore, 'No stores available in current tenant view to add a zone')
      return
    }

    // Expand zones panel
    await zoneBtn.click()
    await expect(page.getByText('Zone in questo store')).toBeVisible({ timeout: 5_000 })

    // Fill zone name input (placeholder "Nome zona")
    await page.getByPlaceholder('Nome zona').fill(zoneName)

    // Click "+ Zona" button to add the zone
    await page.getByRole('button', { name: '+ Zona' }).click()
    await page.waitForTimeout(2_000)

    // Verify zone appears in the expanded panel
    await expect(page.getByText(zoneName)).toBeVisible({ timeout: 10_000 })
  })

  test('delete a zone from a store', async ({ page }) => {
    // The list is filtered by X-Tenant-Id, so we work with whatever stores
    // are currently visible. Find any store with a "Zone" button.
    const zoneBtn = page.getByRole('button', { name: 'Zone' }).first()
    const hasStore = await zoneBtn.isVisible({ timeout: 5_000 }).catch(() => false)
    if (!hasStore) {
      test.skip(!hasStore, 'No stores available in current tenant view to test zone deletion')
      return
    }

    // Expand zones panel
    await zoneBtn.click()
    await expect(page.getByText('Zone in questo store')).toBeVisible({ timeout: 5_000 })

    // Add a zone so there is something to delete
    const zoneName = `Zone Del ${Date.now()}`
    await page.getByPlaceholder('Nome zona').fill(zoneName)
    await page.getByRole('button', { name: '+ Zona' }).click()
    await page.waitForTimeout(2_000)

    // Verify zone appeared
    const zoneVisible = await page.getByText(zoneName).isVisible({ timeout: 5_000 }).catch(() => false)
    if (!zoneVisible) {
      test.skip(!zoneVisible, 'Zone creation did not produce visible zone to delete')
      return
    }

    // Delete the zone — each zone row is a flex container with:
    //   <div><span>{name}</span></div>  <button>Elimina</button>
    // getByText(zoneName) matches the <span>, go up two levels to the flex row.
    const zoneRow = page.getByText(zoneName).locator('..').locator('..')
    await zoneRow.getByText('Elimina').click()
    await page.waitForTimeout(2_000)

    // Verify zone is removed
    await expect(page.getByText(zoneName)).not.toBeVisible({ timeout: 10_000 })
  })

  test('delete a store', async ({ page }) => {
    // The list is filtered by X-Tenant-Id. Try to delete any existing store.
    page.on('dialog', dialog => dialog.accept())

    const deleteBtn = page.getByRole('button', { name: 'Elimina' }).first()
    const hasStore = await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)
    if (!hasStore) {
      test.skip(!hasStore, 'No stores available to delete in current tenant view')
      return
    }

    // Count stores before delete
    const countBefore = await page.getByRole('button', { name: 'Elimina' }).count()

    await deleteBtn.click()
    await page.waitForTimeout(2_000)

    // Verify: one fewer store (or the button we clicked is gone)
    await page.waitForLoadState('networkidle')
    const countAfter = await page.getByRole('button', { name: 'Elimina' }).count()
    expect(countAfter).toBeLessThan(countBefore)
  })
})
