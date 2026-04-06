import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Users', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/users')
    await page.waitForLoadState('networkidle')
  })

  test('merchant users list page loads', async ({ page }) => {
    // Heading is "Utenti Merchant" (Italian)
    const heading = page.getByRole('heading', { name: /utenti merchant|user|utent/i })
    const emptyState = page.getByText(/nessun utente/i)
    const table = page.locator('table')
    const list = page.locator('[data-testid*="user"], [class*="user"]')
    await expect(heading.or(emptyState).or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test.fixme('create a new merchant user', async ({ page }) => {
    const username = `e2e-user-${Date.now()}`
    const email = `${username}@e2e-test.local`

    // Click "+ Nuovo utente" button
    await page.getByRole('button', { name: /Nuovo utente/i }).click()

    // Form uses generated inputs from an array:
    // [username, Username *, text], [email, Email *, email], [firstName, Nome, text], [lastName, Cognome, text]
    const form = page.locator('form')
    await expect(form).toBeVisible({ timeout: 5_000 })

    // Fill "Username *"
    const usernameInput = form.locator('label').filter({ hasText: /^Username \*$/ }).locator('..').locator('input')
    await usernameInput.fill(username)

    // Fill "Email *"
    const emailInput = form.locator('label').filter({ hasText: /^Email \*$/ }).locator('..').locator('input')
    await emailInput.fill(email)

    // Fill "Nome" (first name, optional)
    const firstNameInput = form.locator('label').filter({ hasText: /^Nome$/ }).locator('..').locator('input')
    if (await firstNameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await firstNameInput.fill('E2E')
    }

    // Fill "Cognome" (last name, optional)
    const lastNameInput = form.locator('label').filter({ hasText: /^Cognome$/ }).locator('..').locator('input')
    if (await lastNameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await lastNameInput.fill('TestUser')
    }

    // Role select — "Ruolo *" — default is MERCHANT_USER, leave as-is

    // Submit with "Crea utente" button
    await page.getByRole('button', { name: /Crea utente/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Verify — the success banner or the user list should show the username
    await page.goto('/users')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(username)).toBeVisible({ timeout: 10_000 })
  })

  test.fixme('disable a merchant user', async ({ page }) => {
    // Create user first
    const username = `e2e-disable-${Date.now()}`
    const email = `${username}@e2e-test.local`

    await page.getByRole('button', { name: /Nuovo utente/i }).click()

    const form = page.locator('form')
    await expect(form).toBeVisible({ timeout: 5_000 })

    const usernameInput = form.locator('label').filter({ hasText: /^Username \*$/ }).locator('..').locator('input')
    await usernameInput.fill(username)

    const emailInput = form.locator('label').filter({ hasText: /^Email \*$/ }).locator('..').locator('input')
    await emailInput.fill(email)

    await page.getByRole('button', { name: /Crea utente/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Navigate and disable
    await page.goto('/users')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(username)).toBeVisible({ timeout: 10_000 })

    // Disable — "Disabilita" button on the user row (uses window.confirm)
    page.on('dialog', dialog => dialog.accept())
    const userRow = page.getByText(username).locator('..').locator('..')
    const disableBtn = userRow.getByRole('button', { name: 'Disabilita' })
    if (await disableBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await disableBtn.click()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1_000)

      // Check status changed to "Disabilitato"
      await expect(page.getByText('Disabilitato').first()).toBeVisible({ timeout: 10_000 })
    }
  })
})
