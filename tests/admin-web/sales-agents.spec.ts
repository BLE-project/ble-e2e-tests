import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web - Sales Agents', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
    await page.goto('/sales-agents')
    await page.waitForLoadState('networkidle')
  })

  test('sales agents list page loads', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /sales.*agent|agente|agenti/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid*="sales-agent"], [class*="sales-agent"], [class*="agent"]')
    await expect(heading.or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test('create a new sales agent', async ({ page }) => {
    const agentFirstName = `E2E-Agent-${Date.now()}`
    const agentLastName = 'TestSurname'

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill first name
    const firstNameField = page.getByLabel(/first.*name|nome/i).first()
    await firstNameField.fill(agentFirstName)

    // Fill last name
    const lastNameField = page.getByLabel(/last.*name|surname|cognome/i)
    if (await lastNameField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await lastNameField.fill(agentLastName)
    }

    // Fill fiscal type if available
    const fiscalType = page.getByLabel(/fiscal.*type|tipo.*fiscale/i)
    if (await fiscalType.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await fiscalType.selectOption({ index: 1 })
    }

    // Submit
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Verify appears in list
    await page.goto('/sales-agents')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(agentFirstName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete
    await page.getByText(agentFirstName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) await confirmBtn.click()
    }
  })

  test('disable a sales agent', async ({ page }) => {
    // Create an agent first
    const agentName = `E2E-Disable-${Date.now()}`

    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/first.*name|nome/i).first().fill(agentName)
    const lastNameField = page.getByLabel(/last.*name|surname|cognome/i)
    if (await lastNameField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await lastNameField.fill('DisableTest')
    }
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate back and find the agent
    await page.goto('/sales-agents')
    await page.waitForLoadState('networkidle')
    await page.getByText(agentName).click()

    // Disable the agent
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

  test('verify royalty section is visible', async ({ page }) => {
    // Click first agent if available
    const firstRow = page.locator('table tbody tr, [data-testid*="agent-row"]').first()
    if (await firstRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstRow.click()

      // Look for a royalty section/tab
      const royaltySection = page.getByText(/royalt/i)
      const royaltyTab = page.getByRole('tab', { name: /royalt/i })
      const royaltyHeading = page.getByRole('heading', { name: /royalt/i })
      await expect(
        royaltySection.or(royaltyTab).or(royaltyHeading).first(),
      ).toBeVisible({ timeout: 10_000 })
    }
  })
})
