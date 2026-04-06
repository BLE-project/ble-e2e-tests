import { test, expect } from '@playwright/test'
import { loginViaForm } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'

test.describe('Admin Web - Login', () => {
  test('login with valid credentials redirects to /tenants', async ({ page }) => {
    await loginViaForm(page, ADMIN_USER, ADMIN_PASS)
    await expect(page).toHaveURL(/\/tenants/)
  })

  test('login with invalid credentials shows error message', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await page.locator('input[type="text"]').fill('wrong-user')
    await page.locator('input[type="password"]').fill('wrong-pass')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Error message: "Invalid credentials" or "Login failed. Please try again."
    const errorMessage = page.getByText(/invalid credentials|login failed|credenziali non valide|authentication failed/i)
    await expect(errorMessage).toBeVisible({ timeout: 10_000 })
  })

  test('empty form submission is blocked by browser validation', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /sign in|login|accedi/i }).click()

    // Should still be on login page (browser required validation blocks submission)
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout redirects to /login', async ({ page }) => {
    await loginViaForm(page, ADMIN_USER, ADMIN_PASS)
    await expect(page).not.toHaveURL(/\/login/)

    // Click the sign out / logout button
    const signOutBtn = page.getByRole('button', { name: /sign out|logout|esci/i })
    if (await signOutBtn.isVisible()) {
      await signOutBtn.click()
    } else {
      // Try sidebar or menu-based logout
      const userMenu = page.getByRole('button', { name: /user|menu|account/i })
      if (await userMenu.isVisible()) {
        await userMenu.click()
        await page.getByRole('menuitem', { name: /sign out|logout|esci/i }).click()
      }
    }

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('accessing protected page without token redirects to /login', async ({ page }) => {
    // Clear any existing auth state
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await page.goto('/tenants')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})
