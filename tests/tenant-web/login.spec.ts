import { test, expect } from '@playwright/test'
import { loginViaForm } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'

test.describe('Tenant Web - Login', () => {
  test('login with valid credentials redirects away from /login', async ({ page }) => {
    await loginViaForm(page, TENANT_USER, TENANT_PASS)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('login with invalid credentials shows error message', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/username|email/i).fill('wrong-tenant-user')
    await page.getByLabel(/password/i).fill('wrong-pass')
    await page.getByRole('button', { name: /sign in|login|accedi/i }).click()

    const errorMessage = page.getByText(/invalid credentials|credenziali non valide|authentication failed/i)
    await expect(errorMessage).toBeVisible({ timeout: 10_000 })
  })

  test('empty form submission is blocked by browser validation', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /sign in|login|accedi/i }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout redirects to /login', async ({ page }) => {
    await loginViaForm(page, TENANT_USER, TENANT_PASS)
    await expect(page).not.toHaveURL(/\/login/)

    const signOutBtn = page.getByRole('button', { name: /sign out|logout|esci/i })
    if (await signOutBtn.isVisible()) {
      await signOutBtn.click()
    } else {
      const userMenu = page.getByRole('button', { name: /user|menu|account/i })
      if (await userMenu.isVisible()) {
        await userMenu.click()
        await page.getByRole('menuitem', { name: /sign out|logout|esci/i }).click()
      }
    }

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('accessing protected page without token redirects to /login', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await page.goto('/stores')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})
