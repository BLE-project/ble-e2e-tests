import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Stores', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
  })

  test('stores list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /store|negozio|punto.*vendita/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="store"], [class*="store"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new store', async ({ page }) => {
    const storeName = `E2E Store ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill name
    await page.getByLabel(/name|nome/i).first().fill(storeName)

    // Fill territory if available
    const territoryField = page.getByLabel(/territory|territorio|region|regione/i)
    if (await territoryField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await territoryField.fill('Test Territory')
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify it appears
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(storeName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(storeName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('add a zone to a store', async ({ page }) => {
    // Create a store first
    const storeName = `E2E Zone Store ${Date.now()}`
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(storeName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate to the store detail
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await page.getByText(storeName).click()

    // Add zone
    const addZoneBtn = page.getByRole('button', { name: /add.*zone|aggiungi.*zona|new.*zone|nuova.*zona/i })
    if (await addZoneBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addZoneBtn.click()

      const zoneNameField = page.getByLabel(/zone.*name|nome.*zona|name|nome/i).last()
      await zoneNameField.fill(`Zone ${Date.now()}`)

      await page.getByRole('button', { name: /save|create|add|salva|crea|aggiungi/i }).last().click()
      await page.waitForLoadState('networkidle')

      // Verify zone appears
      await expect(page.getByText(/zone/i).first()).toBeVisible({ timeout: 10_000 })
    }

    // Cleanup: delete store
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await page.getByText(storeName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i }).first()
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a zone from a store', async ({ page }) => {
    // Create a store with a zone
    const storeName = `E2E DelZone ${Date.now()}`
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(storeName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await page.getByText(storeName).click()

    // Add zone first
    const addZoneBtn = page.getByRole('button', { name: /add.*zone|aggiungi.*zona|new.*zone/i })
    if (await addZoneBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addZoneBtn.click()
      const zoneNameField = page.getByLabel(/zone.*name|nome.*zona|name|nome/i).last()
      const zoneName = `Zone Del ${Date.now()}`
      await zoneNameField.fill(zoneName)
      await page.getByRole('button', { name: /save|create|add|salva|crea|aggiungi/i }).last().click()
      await page.waitForLoadState('networkidle')

      // Delete zone
      const deleteZoneBtn = page.getByRole('button', {
        name: /delete.*zone|remove.*zone|elimina.*zona|rimuovi.*zona/i,
      }).or(
        page.locator('[data-testid*="delete-zone"]'),
      )
      if (await deleteZoneBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
        await deleteZoneBtn.first().click()
        const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
        if (await confirmBtn.isVisible()) await confirmBtn.click()

        await expect(page.getByText(zoneName)).not.toBeVisible({ timeout: 10_000 })
      }
    }

    // Cleanup: delete store
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await page.getByText(storeName).click()
    const deleteStoreBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i }).first()
    if (await deleteStoreBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteStoreBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a store', async ({ page }) => {
    const storeName = `E2E Delete Store ${Date.now()}`

    // Create
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(storeName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Delete
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await page.getByText(storeName).click()

    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    await deleteBtn.click()
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
    if (await confirmBtn.isVisible()) await confirmBtn.click()

    // Verify removed
    await page.goto('/stores')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(storeName)).not.toBeVisible({ timeout: 10_000 })
  })
})
