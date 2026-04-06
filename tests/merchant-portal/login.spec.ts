import { test, expect } from '@playwright/test'
import { loginViaKeycloak } from '../../fixtures/auth'

const MERCHANT_USER = process.env.MERCHANT_USER ?? 'dev-merchant'
const MERCHANT_PASS = process.env.MERCHANT_PASS ?? 'dev-pass'
const MERCHANT_URL = process.env.MERCHANT_URL ?? 'http://localhost:5175'
const KC_URL = process.env.KC_URL ?? 'http://localhost:8180'

test.describe('Merchant Portal - Login (OIDC/Keycloak)', () => {
  test('accessing portal without token redirects to Keycloak login', async ({ page }) => {
    // Clear any stored OIDC state
    await page.goto(MERCHANT_URL)
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto(MERCHANT_URL)

    // Should redirect to Keycloak
    await page.waitForURL(new RegExp(KC_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
      timeout: 15_000,
    })

    // Keycloak login page should have username/password fields
    await expect(page.getByLabel(/username|email/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel(/password/i)).toBeVisible()
  })

  test('login via Keycloak redirects back to merchant dashboard', async ({ page }) => {
    // Clear state
    await page.goto(MERCHANT_URL)
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    await loginViaKeycloak(page, MERCHANT_USER, MERCHANT_PASS)

    // Should be back on merchant-portal
    await expect(page).toHaveURL(new RegExp(MERCHANT_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    // Dashboard content should be visible
    const dashboard = page.getByRole('heading', { name: /dashboard|home|benvenuto|welcome/i })
    const content = page.locator('main, [role="main"]')
    await expect(dashboard.or(content).first()).toBeVisible({ timeout: 10_000 })
  })

  test('OIDC token is persisted in storage after login', async ({ page }) => {
    // Clear state
    await page.goto(MERCHANT_URL)
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    await loginViaKeycloak(page, MERCHANT_USER, MERCHANT_PASS)

    // Check that oidc-client-ts stored the token
    const hasToken = await page.evaluate(() => {
      // oidc-client-ts typically stores in sessionStorage with a key like
      // "oidc.user:<authority>:<client_id>"
      const sessionKeys = Object.keys(sessionStorage)
      const localKeys = Object.keys(localStorage)
      const allKeys = [...sessionKeys, ...localKeys]
      return allKeys.some(
        (key) =>
          key.includes('oidc') ||
          key.includes('token') ||
          key.includes('user'),
      )
    })
    expect(hasToken).toBeTruthy()
  })
})
