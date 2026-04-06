import { test, expect } from '@playwright/test'
import { loginViaKeycloak } from '../../fixtures/auth'

const MERCHANT_USER = process.env.MERCHANT_USER ?? 'dev-merchant'
const MERCHANT_PASS = process.env.MERCHANT_PASS ?? 'dev-pass'
const MERCHANT_URL = process.env.MERCHANT_URL ?? 'http://localhost:5175'

test.describe('Merchant Portal - Beacon Groups', () => {
  test.beforeEach(async ({ page }) => {
    // Clear state and login via Keycloak OIDC
    await page.goto(MERCHANT_URL)
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await loginViaKeycloak(page, MERCHANT_USER, MERCHANT_PASS)
    await page.goto(`${MERCHANT_URL}/beacon-groups`)
    await page.waitForLoadState('networkidle')
  })

  test('beacon groups list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /beacon.*group|gruppo.*beacon/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="beacon-group"], [class*="beacon-group"]')
    const emptyState = page.getByText(/no.*group|nessun.*gruppo|empty|vuoto/i)

    await expect(
      heading.or(table).or(list).or(emptyState).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('create a new beacon group', async ({ page }) => {
    const groupName = `E2E BGroup ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill name
    await page.getByLabel(/name|nome/i).first().fill(groupName)

    // Fill description if available
    const descField = page.getByLabel(/description|descrizione/i)
    if (await descField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await descField.fill('E2E test beacon group')
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify
    await page.goto(`${MERCHANT_URL}/beacon-groups`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(groupName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(groupName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a beacon group', async ({ page }) => {
    const groupName = `E2E Delete BGroup ${Date.now()}`

    // Create
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(groupName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Delete
    await page.goto(`${MERCHANT_URL}/beacon-groups`)
    await page.waitForLoadState('networkidle')
    await page.getByText(groupName).click()

    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    await deleteBtn.click()
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
    if (await confirmBtn.isVisible()) await confirmBtn.click()

    // Verify removed
    await page.goto(`${MERCHANT_URL}/beacon-groups`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(groupName)).not.toBeVisible({ timeout: 10_000 })
  })
})
