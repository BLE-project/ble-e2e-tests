import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Beacons', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')
  })

  test('beacons list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /beacon/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="beacon"], [class*="beacon"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new beacon', async ({ page }) => {
    const beaconName = `E2E Beacon ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill name
    await page.getByLabel(/name|nome/i).first().fill(beaconName)

    // Select type if available
    const typeField = page.getByLabel(/type|tipo/i)
    if (await typeField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await typeField.selectOption({ index: 1 })
    }

    // Fill UUID/major/minor if available
    const uuidField = page.getByLabel(/uuid/i)
    if (await uuidField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await uuidField.fill('550e8400-e29b-41d4-a716-446655440000')
    }

    const majorField = page.getByLabel(/major/i)
    if (await majorField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await majorField.fill('1')
    }

    const minorField = page.getByLabel(/minor/i)
    if (await minorField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await minorField.fill('1')
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(beaconName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(beaconName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a beacon', async ({ page }) => {
    const beaconName = `E2E Delete Beacon ${Date.now()}`

    // Create
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(beaconName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Delete
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')
    await page.getByText(beaconName).click()

    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    await deleteBtn.click()
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
    if (await confirmBtn.isVisible()) await confirmBtn.click()

    // Verify removed
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(beaconName)).not.toBeVisible({ timeout: 10_000 })
  })
})
