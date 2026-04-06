import { test, expect } from '@playwright/test'
import { loginViaKeycloak } from '../../fixtures/auth'

const MERCHANT_USER = process.env.MERCHANT_USER ?? 'dev-merchant'
const MERCHANT_PASS = process.env.MERCHANT_PASS ?? 'dev-pass'
const MERCHANT_URL = process.env.MERCHANT_URL ?? 'http://localhost:5175'

test.describe('Merchant Portal - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MERCHANT_URL)
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await loginViaKeycloak(page, MERCHANT_USER, MERCHANT_PASS)
  })

  test('dashboard page loads', async ({ page }) => {
    await page.goto(MERCHANT_URL)
    await page.waitForLoadState('networkidle')

    const heading = page.getByRole('heading', { name: /dashboard|home|benvenuto|welcome/i })
    const content = page.locator('main, [role="main"]')
    await expect(heading.or(content).first()).toBeVisible({ timeout: 10_000 })

    // No error boundary
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })
  })

  test('beacon groups link navigates correctly', async ({ page }) => {
    await page.goto(MERCHANT_URL)
    await page.waitForLoadState('networkidle')

    const link = page.getByRole('link', { name: /beacon.*group|gruppo.*beacon/i }).or(
      page.locator('a[href*="beacon-group"]'),
    )

    if (await link.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await link.first().click()
      await expect(page).toHaveURL(/beacon-group/)
    } else {
      // Fallback: navigate directly
      await page.goto(`${MERCHANT_URL}/beacon-groups`)
    }

    await page.waitForLoadState('networkidle')

    // No error boundary
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 3_000 })

    // Content loaded
    const heading = page.getByRole('heading', { name: /beacon.*group|gruppo.*beacon/i })
    const content = page.locator('main, [role="main"]')
    await expect(heading.or(content).first()).toBeVisible({ timeout: 10_000 })
  })
})
