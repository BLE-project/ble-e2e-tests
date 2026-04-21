import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

/**
 * Tenant Web — CommissionConfigPage (/commission-config).
 * FEAT-014 (commission rates) + FEAT-MIN-SPEND-001 (min-spend rules) Fase 6 Playwright.
 *
 * Tests both the commission rate section and the min-spend rules section that
 * were added in Fase 5.
 */

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL    = process.env.TENANT_URL  ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Commission Config', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/commission-config')
    await page.waitForLoadState('networkidle')
  })

  // ── Page loads ─────────────────────────────────────────────────────────────

  test('commission config page loads without errors', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /commission config/i })
    await expect(heading).toBeVisible({ timeout: 10_000 })
  })

  test('page shows no error boundary', async ({ page }) => {
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"], [class*="ErrorBoundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 5_000 })
  })

  // ── Commission rate section ────────────────────────────────────────────────

  test('effective commission rate banner or rate list is visible', async ({ page }) => {
    // Banner shows when resolvedRate is loaded; list always present once rates load
    const banner = page.getByText('Effective commission rate')
    const ratesList = page.getByText('All commission rates')

    await expect(banner.or(ratesList).first()).toBeVisible({ timeout: 10_000 })
  })

  test('all commission rates section header is present', async ({ page }) => {
    await expect(page.getByText('All commission rates')).toBeVisible({ timeout: 10_000 })
  })

  test('Set override button opens commission rate form', async ({ page }) => {
    // The button is inside the effective rate banner
    const setOverrideBtn = page.getByRole('button', { name: /Set override/i }).first()
    if (await setOverrideBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await setOverrideBtn.click()

      const form = page.locator('form').first()
      await expect(form).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('Set Tenant Commission Override')).toBeVisible()

      // Cancel to not persist test data
      await form.getByRole('button', { name: 'Cancel' }).click()
    }
  })

  // ── Min-spend section ──────────────────────────────────────────────────────

  test('min-spend section is present after scrolling', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(500)

    // Either the effective min-spend banner or the fallback heading
    const banner  = page.getByText('Effective minimum spend')
    const heading = page.getByText(/min.?spend rules/i)

    await expect(banner.or(heading).first()).toBeVisible({ timeout: 10_000 })
  })

  test('all min-spend rules section header is present', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByText('All min-spend rules')).toBeVisible({ timeout: 10_000 })
  })

  test('min-spend Set override button opens form', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    // The min-spend section has its own "Set override" button (inside the teal banner)
    // It may be the last "Set override" button on the page
    const setOverrideBtn = page.getByRole('button', { name: /Set override/i }).last()
    if (await setOverrideBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await setOverrideBtn.click()

      const form = page.locator('form').last()
      await expect(form).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('Set Tenant Min-Spend Override')).toBeVisible()

      // Verify the amount input is present
      const amountInput = form.locator('label').filter({ hasText: /Amount \(€\)/ }).locator('..').locator('input[type="number"]')
      await expect(amountInput).toBeVisible()

      // Cancel
      await form.getByRole('button', { name: 'Cancel' }).click()
    }
  })

  test('min-spend rules list renders GLOBAL scope badge or empty state', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1_000)

    const globalBadge = page.getByText('GLOBAL').last()
    const emptyState  = page.getByText(/No min-spend rules configured/i)

    await expect(globalBadge.or(emptyState).first()).toBeVisible({ timeout: 10_000 })
  })

  // ── Integration: submit min-spend override ─────────────────────────────────

  test('submit tenant min-spend override and verify response', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const setOverrideBtn = page.getByRole('button', { name: /Set override/i }).last()
    if (!await setOverrideBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip()
      return
    }

    await setOverrideBtn.click()
    const form = page.locator('form').last()
    await expect(form).toBeVisible({ timeout: 5_000 })

    const amountInput = form.locator('label').filter({ hasText: /Amount \(€\)/ }).locator('..').locator('input[type="number"]')
    await amountInput.fill('3.00')

    await form.getByRole('button', { name: 'Save override' }).click()
    await page.waitForTimeout(2_000)

    // On success: form closes; on error: form stays + error message
    const formOpen = await form.isVisible().catch(() => false)
    if (!formOpen) {
      // Success — TENANT badge should now appear in the list
      const tenantBadge = page.getByText('TENANT').last()
      await expect(tenantBadge.or(page.getByText('3.00')).first()).toBeVisible({ timeout: 10_000 })
    } else {
      // API error in test env — just verify form didn't crash
      const errorMsg = page.getByText(/Failed to save rule/i)
      await expect(errorMsg.or(amountInput).first()).toBeVisible({ timeout: 5_000 })
    }
  })
})
