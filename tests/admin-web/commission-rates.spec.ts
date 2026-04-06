import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web - Commission Rates', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
    await page.goto('/commission-rates')
    await page.waitForLoadState('networkidle')
  })

  test('commission rates list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /commission|rate|commissione|tariffa/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="commission"], [class*="commission"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a global commission rate', async ({ page }) => {
    const rateName = `E2E Global Rate ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill name/description
    const nameField = page.getByLabel(/name|description|nome|descrizione/i).first()
    await nameField.fill(rateName)

    // Fill rate percentage
    const rateField = page.getByLabel(/rate|percentage|percentuale|tariffa/i)
    if (await rateField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await rateField.fill('5.00')
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify
    await page.goto('/commission-rates')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(rateName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(rateName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('create a tenant-specific commission rate', async ({ page }) => {
    const rateName = `E2E Tenant Rate ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill name
    const nameField = page.getByLabel(/name|description|nome|descrizione/i).first()
    await nameField.fill(rateName)

    // Fill rate
    const rateField = page.getByLabel(/rate|percentage|percentuale|tariffa/i)
    if (await rateField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await rateField.fill('3.50')
    }

    // Select a tenant if there is a tenant dropdown
    const tenantSelect = page.getByLabel(/tenant/i)
    if (await tenantSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await tenantSelect.selectOption({ index: 1 })
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify
    await page.goto('/commission-rates')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(rateName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(rateName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a commission rate', async ({ page }) => {
    const rateName = `E2E Delete Rate ${Date.now()}`

    // Create a rate first
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    const nameField = page.getByLabel(/name|description|nome|descrizione/i).first()
    await nameField.fill(rateName)
    const rateField = page.getByLabel(/rate|percentage|percentuale|tariffa/i)
    if (await rateField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await rateField.fill('2.00')
    }
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate back and delete
    await page.goto('/commission-rates')
    await page.waitForLoadState('networkidle')
    await page.getByText(rateName).click()

    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    await deleteBtn.click()
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click()
    }

    // Verify removed
    await page.goto('/commission-rates')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(rateName)).not.toBeVisible({ timeout: 10_000 })
  })
})
