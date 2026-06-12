import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

/**
 * Admin Web — RBAC route guards (audit gap, 2026-06-12).
 *
 * The admin SPA wraps SUPER_ADMIN-only pages in <ProtectedRoute requiredRole>,
 * which redirects to /forbidden on a role mismatch and to /login when
 * unauthenticated. None of this was exercised — a regression that dropped the
 * guard (or the redirect) would have shipped silently. These tests assert the
 * three branches: unauth → /login, low-role → /forbidden, SUPER_ADMIN → renders.
 */
const SUPER_ADMIN = process.env.ADMIN_USER ?? 'dev-super-admin'
const LOW_ROLE    = process.env.ANALYST_USER ?? 'dev-pa-analyst' // PA_ANALYST, not SUPER_ADMIN
const PASS        = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL    = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

/** A route gated by <ProtectedRoute requiredRole="SUPER_ADMIN">. */
const SUPER_ADMIN_ROUTE = '/analyst-territories'

test.describe('Admin Web — RBAC route guards', () => {
  test('unauthenticated access to a protected route redirects to /login', async ({ page }) => {
    await page.goto(SUPER_ADMIN_ROUTE)
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('a non-SUPER_ADMIN user is redirected to /forbidden', async ({ page }) => {
    await loginViaApi(page, BASE_URL, LOW_ROLE, PASS, STORAGE_KEY)
    // Prime the SPA auth state on the root route before deep-linking, so the
    // ProtectedRoute evaluates against a resolved identity (mirrors navigation.spec).
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.goto(SUPER_ADMIN_ROUTE)
    await expect(page).toHaveURL(/\/forbidden/, { timeout: 10_000 })
  })

  test('a SUPER_ADMIN user reaches the protected route', async ({ page }) => {
    await loginViaApi(page, BASE_URL, SUPER_ADMIN, PASS, STORAGE_KEY)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.goto(SUPER_ADMIN_ROUTE)
    await expect(page).toHaveURL(/analyst-territories/, { timeout: 10_000 })
    await expect(page).not.toHaveURL(/\/forbidden/)
  })
})
