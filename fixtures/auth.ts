import { expect, Page } from '@playwright/test'

/**
 * Login via the custom auth form used by admin-web and tenant-web.
 * Fills username/password and clicks the sign-in button.
 */
export async function loginViaForm(
  page: Page,
  username: string,
  password: string,
) {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  // The label is "Username or Email" — use placeholder or input[type=text] as fallback
  const usernameInput = page.locator('input[type="text"]')
  await usernameInput.fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
}

/**
 * Login via the BFF REST API and inject the token into localStorage.
 * Faster than form-based login; use for tests that don't specifically
 * test the login UI.
 */
export async function loginViaApi(
  page: Page,
  baseUrl: string,
  username: string,
  password: string,
  storageKey: string,
) {
  const bffUrl = process.env.BFF_URL ?? 'http://localhost:8080'
  const response = await page.request.post(`${bffUrl}/api/v1/auth/login`, {
    data: { username, password },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const token: string = body.token

  await page.goto(baseUrl)
  await page.evaluate(
    ([key, tkn]) => localStorage.setItem(key, tkn),
    [storageKey, token],
  )
  await page.reload()
  return token
}

/**
 * Login via Keycloak OIDC redirect flow used by the merchant-portal.
 * Navigates to the app, follows the redirect to KC, fills the form,
 * and waits for the redirect back.
 */
export async function loginViaKeycloak(
  page: Page,
  username: string,
  password: string,
) {
  const kcUrl = process.env.KC_URL ?? 'http://localhost:8180'

  await page.goto('/')
  // Wait for redirect to Keycloak
  await page.waitForURL(new RegExp(kcUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
    timeout: 15_000,
  })

  await page.getByLabel(/username|email/i).fill(username)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).click()

  // Wait for redirect back to merchant-portal
  const merchantUrl = process.env.MERCHANT_URL ?? 'http://localhost:5175'
  await page.waitForURL(new RegExp(merchantUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
    timeout: 15_000,
  })
}
