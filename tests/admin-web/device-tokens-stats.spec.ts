import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

/**
 * T-162 L3 — Admin-web Playwright tests for Device Token Stats page.
 *
 * Tests the /device-tokens-stats route which calls:
 *   GET /v1/device-tokens/stats → notification-service
 *   (proxied by BFF TransparentProxy via device-tokens segment)
 *
 * Preconditions:
 *   - admin-web running on http://localhost:5174
 *   - BFF + notification-service reachable
 *   - dev-super-admin user in Keycloak with SUPER_ADMIN role
 */

const ADMIN_USER  = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS  = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL    = process.env.ADMIN_URL  ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web — Device Token Stats (T-162)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
  })

  test('sidebar has Push Token Stats link', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const link = page.getByRole('link', { name: /push token stats/i })
    await expect(link).toBeVisible()
  })

  test('navigates to device-tokens-stats page via sidebar', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: /push token stats/i }).click()
    await expect(page).toHaveURL(/\/device-tokens-stats/)
    await expect(
      page.getByRole('heading', { name: /device token stats/i }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('stats page renders three stat cards', async ({ page }) => {
    await page.goto('/device-tokens-stats')
    await page.waitForLoadState('networkidle')

    // Page container
    await expect(page.getByTestId('device-tokens-stats-page')).toBeVisible()

    // Either the grid (notification-service up) or the error banner (service down)
    const gridVisible = await page
      .getByTestId('stats-grid')
      .isVisible({ timeout: 10_000 })
      .catch(() => false)

    if (gridVisible) {
      // Three stat cards are rendered
      await expect(page.getByTestId('consumer-token-count')).toBeVisible()
      await expect(page.getByTestId('sales-agent-token-count')).toBeVisible()
      await expect(page.getByTestId('oldest-consumer-last-seen')).toBeVisible()

      // Values must be numeric-looking or a relative time string
      const consumerText = await page.getByTestId('consumer-token-count').innerText()
      expect(Number(consumerText.replace(/,/g, '')) >= 0).toBeTruthy()

      const salesText = await page.getByTestId('sales-agent-token-count').innerText()
      expect(Number(salesText.replace(/,/g, '')) >= 0).toBeTruthy()
    } else {
      // Notification service unavailable in this environment — error banner shown
      await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 10_000 })
    }
  })

  test('refresh button is present', async ({ page }) => {
    await page.goto('/device-tokens-stats')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('refresh-btn')).toBeVisible()
  })

  test('direct URL /device-tokens-stats loads without redirect', async ({ page }) => {
    await page.goto('/device-tokens-stats')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByTestId('device-tokens-stats-page')).toBeVisible({ timeout: 15_000 })
  })
})
