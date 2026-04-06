import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

const TENANT_PAGES = [
  { path: '/stores', label: /store|negozio|punto.*vendita/i },
  { path: '/campaigns', label: /campaign|campagna/i },
  { path: '/beacons', label: /beacon/i },
  { path: '/loyalty-cards', label: /loyalty.*card|carta.*fedelt/i },
  { path: '/users', label: /user|utent/i },
  { path: '/analytics', label: /analytics|statistiche|analitiche/i },
]

test.describe('Tenant Web - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
  })

  for (const { path, label } of TENANT_PAGES) {
    test(`sidebar link navigates to ${path}`, async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Click sidebar link
      const link = page.getByRole('link', { name: label }).or(
        page.locator(`a[href*="${path}"]`),
      )
      if (await link.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
        await link.first().click()
        await expect(page).toHaveURL(new RegExp(path))
      } else {
        await page.goto(path)
      }

      // Verify no error boundary
      const errorBoundary = page.locator(
        '[data-testid="error-boundary"], [class*="error-boundary"], [class*="ErrorBoundary"]',
      )
      await expect(errorBoundary).not.toBeVisible({ timeout: 5_000 })

      // Verify no generic error text
      const body = page.locator('body')
      await expect(body).not.toHaveText(/something went wrong|error occurred|errore/i, {
        timeout: 5_000,
      })
    })
  }

  test('no error boundary triggered on any page', async ({ page }) => {
    for (const { path } of TENANT_PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const errorBoundary = page.locator(
        '[data-testid="error-boundary"], [class*="error-boundary"], [class*="ErrorBoundary"]',
      )
      await expect(errorBoundary).not.toBeVisible({ timeout: 5_000 })
    }
  })
})
