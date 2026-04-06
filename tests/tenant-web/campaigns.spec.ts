import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
  })

  test('campaigns list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /campaign|campagna/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="campaign"], [class*="campaign"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new campaign', async ({ page }) => {
    const campaignTitle = `E2E Campaign ${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill title
    const titleField = page.getByLabel(/title|titolo|name|nome/i).first()
    await titleField.fill(campaignTitle)

    // Fill body/description
    const bodyField = page.getByLabel(/body|description|corpo|descrizione|content|contenuto/i)
    if (await bodyField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await bodyField.fill('E2E test campaign description body content')
    }

    // Select category if available
    const categoryField = page.getByLabel(/category|categoria/i)
    if (await categoryField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await categoryField.selectOption({ index: 1 })
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(campaignTitle)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(campaignTitle).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('delete a campaign', async ({ page }) => {
    const campaignTitle = `E2E Delete Campaign ${Date.now()}`

    // Create
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/title|titolo|name|nome/i).first().fill(campaignTitle)
    const bodyField = page.getByLabel(/body|description|corpo|descrizione|content|contenuto/i)
    if (await bodyField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await bodyField.fill('To be deleted')
    }
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Delete
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
    await page.getByText(campaignTitle).click()

    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    await deleteBtn.click()
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
    if (await confirmBtn.isVisible()) await confirmBtn.click()

    // Verify removed
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(campaignTitle)).not.toBeVisible({ timeout: 10_000 })
  })
})
