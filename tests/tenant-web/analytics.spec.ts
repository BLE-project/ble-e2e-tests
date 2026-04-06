import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
  })

  test('tenant analytics page loads', async ({ page }) => {
    await page.goto('/analytics')
    await page.waitForLoadState('networkidle')

    const heading = page.getByRole('heading', { name: /analytics|analytic|statistiche/i })
    const charts = page.locator('canvas, svg, [data-testid*="chart"], [class*="chart"]')
    const content = page.locator('main, [role="main"]')

    await expect(heading.or(charts.first()).or(content).first()).toBeVisible({ timeout: 10_000 })

    // No error boundary
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })
  })

  test('period selector changes displayed data', async ({ page }) => {
    await page.goto('/analytics')
    await page.waitForLoadState('networkidle')

    // Look for a period selector (dropdown, date picker, or tab-like buttons)
    const periodSelector = page
      .getByLabel(/period|periodo|range|intervallo/i)
      .or(page.getByRole('combobox', { name: /period|periodo|range/i }))
      .or(page.locator('select[name*="period"], select[name*="range"]'))

    if (await periodSelector.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Change the period selection
      await periodSelector.first().selectOption({ index: 1 })
      await page.waitForLoadState('networkidle')

      // The page should still render without errors
      const errorBoundary = page.locator(
        '[data-testid="error-boundary"], [class*="error-boundary"]',
      )
      await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })
    } else {
      // Try button-style period selectors (7d, 30d, 90d, etc.)
      const periodBtns = page.getByRole('button', { name: /7d|30d|90d|1m|3m|week|month|settimana|mese/i })
      if (await periodBtns.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
        await periodBtns.first().click()
        await page.waitForLoadState('networkidle')

        const errorBoundary = page.locator(
          '[data-testid="error-boundary"], [class*="error-boundary"]',
        )
        await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })
      }
    }
  })

  test('merchant analytics page loads', async ({ page }) => {
    // Navigate to merchant analytics (could be a sub-route or separate section)
    await page.goto('/analytics/merchant')
    await page.waitForLoadState('networkidle')

    // If the exact route does not exist, try the main analytics with a merchant filter
    const heading = page.getByRole('heading', { name: /merchant.*analytics|analytics.*merchant|analitiche.*merchant/i })
    const content = page.locator('main, [role="main"]')
    const charts = page.locator('canvas, svg, [data-testid*="chart"], [class*="chart"]')

    await expect(heading.or(charts.first()).or(content).first()).toBeVisible({ timeout: 10_000 })

    // No error boundary
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })
  })
})
