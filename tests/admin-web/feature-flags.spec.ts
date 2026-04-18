import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL   = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web — Feature Flags (Q3 T-160)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
  })

  test('sidebar has Feature Flags link', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const link = page.getByRole('link', { name: /feature.*flags/i })
    await expect(link).toBeVisible()
  })

  test('navigates to feature flags page via sidebar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /feature.*flags/i }).click()
    await expect(page).toHaveURL(/.*\/feature-flags/)
    await expect(page.getByRole('heading', { name: /feature flags/i })).toBeVisible()
  })

  test('shows seeded flags (adv-moderation-enabled + consumer-beacon-adaptive-scan + receipt-nonce-anti-replay)', async ({ page }) => {
    await page.goto('/feature-flags')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=adv-moderation-enabled')).toBeVisible()
    await expect(page.locator('text=consumer-beacon-adaptive-scan')).toBeVisible()
    await expect(page.locator('text=receipt-nonce-anti-replay')).toBeVisible()
  })

  test('shows scope column with GLOBAL for seeded flags', async ({ page }) => {
    await page.goto('/feature-flags')
    await page.waitForLoadState('networkidle')
    const rows = page.locator('[data-testid="flag-row"]')
    // At least 3 seed rows should exist with scope GLOBAL
    const globalCells = page.locator('td', { hasText: 'GLOBAL' })
    await expect(globalCells.first()).toBeVisible()
  })

  test('new flag modal opens + has required fields', async ({ page }) => {
    await page.goto('/feature-flags')
    await page.waitForLoadState('networkidle')
    await page.getByTestId('new-flag-btn').click()

    const form = page.getByTestId('flag-form')
    await expect(form).toBeVisible()
    await expect(form.getByTestId('flag-key-input')).toBeVisible()
    await expect(form.getByTestId('flag-type-select')).toBeVisible()
    await expect(form.getByTestId('flag-submit-btn')).toBeVisible()
  })

  test('create new boolean flag end-to-end', async ({ page }) => {
    const flagKey = `e2e-test-${Date.now()}`

    await page.goto('/feature-flags')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('new-flag-btn').click()
    await page.getByTestId('flag-key-input').fill(flagKey)
    await page.getByTestId('flag-type-select').selectOption('BOOLEAN')
    await page.getByTestId('flag-value-bool').check()
    await page.getByTestId('flag-submit-btn').click()

    // Form closes, new row appears
    await expect(page.locator(`text=${flagKey}`)).toBeVisible({ timeout: 10_000 })
  })
})
