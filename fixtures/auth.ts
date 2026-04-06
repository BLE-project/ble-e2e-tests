import { expect, Page } from '@playwright/test'

import { loadSeedDataSync } from './seed-data'

/**
 * Default dev tenant ID — loaded from seed data file written by global-setup.
 * Falls back to a placeholder UUID if seed data is not available.
 */
export const DEV_TENANT_ID_FALLBACK = '00000000-0000-0000-0000-000000000001'

function resolveDevTenantId(): string {
  // Check env first (set by global-setup in the main process)
  if (process.env.DEV_TENANT_ID) return process.env.DEV_TENANT_ID
  // Then try loading from seed data file
  const seed = loadSeedDataSync()
  if (seed) return seed.tenantId
  return DEV_TENANT_ID_FALLBACK
}

export const DEV_TENANT_ID = resolveDevTenantId()

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
 *
 * Also sets up a route handler that adds X-Tenant-Id header to all
 * API requests (required by the BFF TenantRoutingFilter).
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

  // Intercept all BFF API requests and add X-Tenant-Id header.
  // Uses the dynamically resolved tenant ID from seed data.
  const tenantId = DEV_TENANT_ID !== DEV_TENANT_ID_FALLBACK ? DEV_TENANT_ID : DEV_TENANT_ID_FALLBACK
  const bffPattern = `${bffUrl}/api/**`
  await page.route(bffPattern, async (route) => {
    const headers = {
      ...route.request().headers(),
      'x-tenant-id': tenantId,
    }
    await route.continue({ headers })
  })
  // Also match Vite-proxied requests (page origin /api/...)
  await page.route('**/api/**', async (route) => {
    const headers = {
      ...route.request().headers(),
      'x-tenant-id': tenantId,
    }
    await route.continue({ headers })
  })

  await page.reload()
  return token
}

/**
 * Login via Keycloak OIDC redirect flow used by the merchant-portal.
 * 1. Navigate to the merchant-portal
 * 2. Click "Sign in with Keycloak" button (initiates PKCE redirect)
 * 3. Fill the Keycloak login form (#username, #password, #kc-login)
 * 4. Wait for redirect back to the merchant-portal
 */
export async function loginViaKeycloak(
  page: Page,
  username: string,
  password: string,
) {
  const kcUrl = process.env.KC_URL ?? 'http://localhost:8180'
  const merchantUrl = process.env.MERCHANT_URL ?? 'http://localhost:5175'

  // 1. Navigate to merchant portal
  await page.goto(merchantUrl)
  await page.waitForLoadState('networkidle')

  // 2. Click "Sign in with Keycloak" — this initiates the OIDC PKCE redirect
  const signInBtn = page.getByRole('button', { name: /Sign in with Keycloak/i })
  await expect(signInBtn).toBeVisible({ timeout: 10_000 })
  await signInBtn.click()

  // 3. Wait for redirect to Keycloak login page
  await page.waitForURL(new RegExp(kcUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
    timeout: 15_000,
  })

  // 4. Fill the Keycloak login form using direct selectors
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('#kc-login').click()

  // 5. Wait for redirect back to merchant-portal
  await page.waitForURL(new RegExp(merchantUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')
}
