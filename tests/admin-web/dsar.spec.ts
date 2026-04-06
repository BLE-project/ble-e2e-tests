import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web - DSAR (Data Subject Access Requests)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
    await page.goto('/dsar')
    await page.waitForLoadState('networkidle')
  })

  test('DSAR page loads without errors', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /dsar|privacy|data.*request|data.*subject/i })
    const content = page.locator('[data-testid*="dsar"], [class*="dsar"]')
    const pageBody = page.locator('main, [role="main"]')

    await expect(heading.or(content).or(pageBody).first()).toBeVisible({ timeout: 10_000 })

    // No error boundary
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })
  })

  test('search for a data subject', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search|cerca|email|username/i).or(
      page.getByLabel(/search|cerca|email|username/i),
    )

    if (await searchInput.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.first().fill('dev-consumer')
      // Press Enter or click search button
      const searchBtn = page.getByRole('button', { name: /search|cerca|find|trova/i })
      if (await searchBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await searchBtn.click()
      } else {
        await searchInput.first().press('Enter')
      }

      await page.waitForLoadState('networkidle')

      // Results area should be visible (even if empty)
      const results = page.locator('table, [data-testid*="result"], [class*="result"]')
      const noResults = page.getByText(/no.*result|nessun.*risultato|not.*found|non.*trovato/i)
      await expect(results.first().or(noResults)).toBeVisible({ timeout: 10_000 })
    }
  })

  test('initiate data export request', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export|download|esporta|scarica/i })

    if (await exportBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await exportBtn.click()

      // Confirmation or dialog
      const confirmDialog = page.getByRole('dialog')
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click()
        }
      }

      // Success toast or message
      const success = page.getByText(/request.*sent|success|richiesta.*inviata|successo/i)
      await expect(success).toBeVisible({ timeout: 10_000 })
    }
  })

  test('initiate data deletion request', async ({ page }) => {
    const deleteBtn = page.getByRole('button', {
      name: /delete.*data|erase|cancella.*dati|elimina.*dati/i,
    })

    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()

      // Confirmation dialog
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await confirmBtn.click()
      }

      // Success message
      const success = page.getByText(/request.*sent|queued|success|richiesta|coda|successo/i)
      await expect(success).toBeVisible({ timeout: 10_000 })
    }
  })
})
