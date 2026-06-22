import { test, expect } from '@playwright/test'
import { loginViaOidcSession } from '../../fixtures/auth'

/**
 * #86 — Tenant Web RBAC route guards (the tenant-web half of the role-guard gap).
 *
 * admin-web's role guards got coverage in #88; tenant-web's never did, even
 * though several routes are gated by <ProtectedRoute roles={[...]}> which calls
 * `window.location.replace('/forbidden')` on a role mismatch (src/auth/
 * ProtectedRoute.tsx) — a regression dropping that guard would ship silently.
 *
 * Routes & required roles (terrio-backoffice-tenant-web src/App.tsx):
 *   /tenant-ble-config → roles={['TENANT_ADMIN','SUPER_ADMIN']}
 *   /users             → roles={['TENANT_ADMIN','SUPER_ADMIN']}
 * Role source: AuthContext.extractRoles reads profile.ble_roles / profile.roles /
 * realm_access.roles — exactly the OIDC profile that loginViaOidcSession seeds
 * from the BFF login JWT (same token admin-web's PA_ANALYST guard test exercises).
 *
 * The unauthenticated branch (→ Keycloak signinRedirect) is already covered by
 * tenant-web/login.spec.ts; this file covers the authenticated low-role vs
 * authorized branches.
 *
 * Requires the stack (BFF + Keycloak + tenant-web) like the other tenant-web
 * specs — it is a stack integration test, not a local unit.
 */
const TENANT_ADMIN = process.env.TENANT_USER ?? 'dev-tenant-admin' // TENANT_ADMIN
const LOW_ROLE     = process.env.ANALYST_USER ?? 'dev-pa-analyst'  // PA_ANALYST — lacks TENANT_ADMIN/SUPER_ADMIN
const PASS         = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL     = process.env.TENANT_URL ?? 'http://localhost:5173'

/** A route gated by <ProtectedRoute roles={['TENANT_ADMIN','SUPER_ADMIN']}>. */
const ADMIN_ONLY_ROUTE = '/tenant-ble-config'

test.describe('Tenant Web — RBAC route guards (#86)', () => {
  test('a non-admin (PA_ANALYST) user is redirected to /forbidden', async ({ page }) => {
    await loginViaOidcSession(page, BASE_URL, LOW_ROLE, PASS)
    // Prime the SPA auth state on the root before deep-linking so ProtectedRoute
    // evaluates against a resolved identity (mirrors the other tenant-web specs).
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.goto(ADMIN_ONLY_ROUTE)
    await expect(page).toHaveURL(/\/forbidden/, { timeout: 10_000 })
  })

  test('a TENANT_ADMIN user reaches the admin-only route', async ({ page }) => {
    await loginViaOidcSession(page, BASE_URL, TENANT_ADMIN, PASS)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.goto(ADMIN_ONLY_ROUTE)
    await expect(page).toHaveURL(/tenant-ble-config/, { timeout: 10_000 })
    await expect(page).not.toHaveURL(/\/forbidden/)
  })
})
