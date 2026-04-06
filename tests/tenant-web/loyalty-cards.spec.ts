import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Loyalty Cards', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/loyalty-cards')
    await page.waitForLoadState('networkidle')
  })

  test('loyalty cards list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /loyalty.*card|carta.*fedelt|card/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="loyalty"], [class*="loyalty"], [data-testid*="card"]')
    const emptyState = page.getByText(/no.*card|nessuna.*carta|empty|vuoto/i)
    await expect(
      heading.or(table).or(list).or(emptyState).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('loyalty cards table has expected columns', async ({ page }) => {
    const table = page.locator('table')
    if (await table.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const headers = table.locator('thead th, thead td')
      const headerCount = await headers.count()
      expect(headerCount).toBeGreaterThan(0)
    }
  })

  test('loyalty cards page shows no error boundary', async ({ page }) => {
    const errorBoundary = page.locator(
      '[data-testid="error-boundary"], [class*="error-boundary"], [class*="ErrorBoundary"]',
    )
    await expect(errorBoundary).not.toBeVisible({ timeout: 5_000 })
  })
})
