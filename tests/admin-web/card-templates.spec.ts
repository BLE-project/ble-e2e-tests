import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web - Card Templates', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
    await page.goto('/card-templates')
    await page.waitForLoadState('networkidle')
  })

  test('card templates list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /card template|template/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="card-template"], [class*="card-template"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new card template', async ({ page }) => {
    const templateName = `E2E Template ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill name
    await page.getByLabel(/name|nome/i).first().fill(templateName)

    // Fill primary color if available
    const primaryColor = page.getByLabel(/primary.*color|colore.*primario/i)
    if (await primaryColor.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await primaryColor.fill('#3B82F6')
    }

    // Fill secondary color if available
    const secondaryColor = page.getByLabel(/secondary.*color|colore.*secondario/i)
    if (await secondaryColor.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await secondaryColor.fill('#1E3A5F')
    }

    // Select barcode type if available
    const barcodeSelect = page.getByLabel(/barcode|codice.*barre/i)
    if (await barcodeSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await barcodeSelect.selectOption({ index: 1 })
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify it appears
    await page.goto('/card-templates')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(templateName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(templateName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('edit an existing card template', async ({ page }) => {
    // Create a template first
    const templateName = `E2E Edit ${Date.now()}`
    const updatedName = `${templateName} Updated`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(templateName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate back and click the template
    await page.goto('/card-templates')
    await page.waitForLoadState('networkidle')
    await page.getByText(templateName).click()

    // Edit name
    const nameField = page.getByLabel(/name|nome/i).first()
    await nameField.clear()
    await nameField.fill(updatedName)
    await page.getByRole('button', { name: /save|update|salva|aggiorna/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify updated
    await page.goto('/card-templates')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(updatedName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a card template', async ({ page }) => {
    // Create a template to delete
    const templateName = `E2E Delete ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(templateName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate back and delete
    await page.goto('/card-templates')
    await page.waitForLoadState('networkidle')
    await page.getByText(templateName).click()

    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    await deleteBtn.click()
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click()
    }

    // Verify removed
    await page.goto('/card-templates')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(templateName)).not.toBeVisible({ timeout: 10_000 })
  })
})
