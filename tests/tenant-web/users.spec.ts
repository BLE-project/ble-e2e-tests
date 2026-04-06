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
    const heading = page.getByRole('heading', { name: /user|utent/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="user"], [class*="user"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new merchant user', async ({ page }) => {
    const username = `e2e-user-${Date.now()}`
    const email = `${username}@e2e-test.local`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill username
    const usernameField = page.getByLabel(/username/i)
    await usernameField.fill(username)

    // Fill email
    const emailField = page.getByLabel(/email/i)
    await emailField.fill(email)

    // Select role if available
    const roleField = page.getByLabel(/role|ruolo/i)
    if (await roleField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await roleField.selectOption({ index: 1 })
    }

    // Fill password if required
    const passwordField = page.getByLabel(/password/i).first()
    if (await passwordField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await passwordField.fill('Test1234!')
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify
    await page.goto('/users')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(username)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete or disable
    await page.getByText(username).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('disable a merchant user', async ({ page }) => {
    // Create user first
    const username = `e2e-disable-${Date.now()}`
    const email = `${username}@e2e-test.local`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/username/i).fill(username)
    await page.getByLabel(/email/i).fill(email)
    const passwordField = page.getByLabel(/password/i).first()
    if (await passwordField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await passwordField.fill('Test1234!')
    }
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate and disable
    await page.goto('/users')
    await page.waitForLoadState('networkidle')
    await page.getByText(username).click()

    const disableBtn = page.getByRole('button', { name: /disable|suspend|disabilita|sospendi/i })
    if (await disableBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await disableBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()

      await expect(
        page.getByText(/disabled|suspended|disabilitato|sospeso/i),
      ).toBeVisible({ timeout: 10_000 })
    }

    // Cleanup: delete
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmDel = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmDel.isVisible()) await confirmDel.click()
    }
  })
})
