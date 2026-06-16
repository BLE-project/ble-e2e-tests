import { test, expect } from '@playwright/test'

/**
 * Tenant Web auth is OIDC PKCE (oidc-client-ts + Keycloak) — there is NO in-app
 * /login form or /login route. The previous specs filled a username/password
 * form and asserted /login URLs, which never existed: they passed for the wrong
 * reasons (false-positive coverage, #292). These assert the REAL behaviour:
 * an unauthenticated visit triggers ProtectedRoute.signinRedirect() → the
 * Keycloak authorize endpoint (.../realms/<realm>/protocol/openid-connect/auth).
 *
 * Authenticated journeys use the loginViaOidcSession fixture (seeds the
 * oidc-client-ts session so ProtectedRoute does not redirect to Keycloak — see
 * the other tenant-web specs); this file only covers the unauthenticated gate.
 */
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'

// Keycloak's OpenID authorize endpoint, regardless of host/realm.
const KC_AUTHORIZE = /\/protocol\/openid-connect\/auth/

test.describe('Tenant Web - OIDC auth gate', () => {
  // Each test runs in a fresh Playwright context (no stored OIDC session), so an
  // unauthenticated gate is the natural starting state — no explicit clear needed
  // (and clearing post-redirect would run on the Keycloak origin, cross-origin).

  test('unauthenticated access to a protected route redirects to Keycloak', async ({ page }) => {
    // The SPA fires signinRedirect (full-page nav) which aborts the initial goto;
    // that abort IS the redirect, so swallow it and assert the landing URL.
    await page.goto(`${BASE_URL}/stores`).catch(() => {})
    await page.waitForURL(KC_AUTHORIZE, { timeout: 15_000 })
    await expect(page).toHaveURL(KC_AUTHORIZE)
  })

  test('unauthenticated access to the root redirects to Keycloak', async ({ page }) => {
    await page.goto(BASE_URL).catch(() => {})
    await page.waitForURL(KC_AUTHORIZE, { timeout: 15_000 })
    await expect(page).toHaveURL(KC_AUTHORIZE)
  })

  // NB: asserting the Keycloak login FORM (#username) would additionally depend
  // on the realm client having this run's redirect_uri registered; that is an
  // env/realm-config concern (known localhost-vs-LAN mismatch), not app
  // behaviour. The two redirects above already prove auth is delegated to
  // Keycloak (no in-app /login form), which is the #292 false-positive fix.
})
