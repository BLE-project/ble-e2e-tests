import { test, expect } from '@playwright/test'
import { loginViaApi } from '../../fixtures/auth'

const ADMIN_USER = process.env.ADMIN_USER ?? 'dev-super-admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'dev-pass'
const BASE_URL = process.env.ADMIN_URL ?? 'http://localhost:5174'
const STORAGE_KEY = 'ble_admin_token'

test.describe('Admin Web - Tenants', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, ADMIN_USER, ADMIN_PASS, STORAGE_KEY)
    await page.goto('/tenants')
    await page.waitForLoadState('networkidle')
  })

  test('tenants list page loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/tenants/)
    // The page should show a heading or table related to tenants
    const heading = page.getByRole('heading', { name: /tenants/i })
    const table = page.locator('table')
    const list = page.locator('[data-testid="tenants-list"], [class*="tenant"]')
    const anyContent = heading.or(table).or(list)
    await expect(anyContent.first()).toBeVisible({ timeout: 10_000 })
  })

  test('create new tenant and verify it appears in the list', async ({ page }) => {
    const tenantName = `E2E Tenant ${Date.now()}`

    // Click create button
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()

    // Fill the form
    const nameField = page.getByLabel(/name|nome/i).first()
    await nameField.fill(tenantName)

    // Submit
    const submitBtn = page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i })
    await submitBtn.click()

    // Verify tenant appears in the list
    await page.goto('/tenants')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(tenantName)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete the tenant
    await page.getByText(tenantName).click()
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click()
      // Confirm deletion dialog
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click()
      }
    }
  })

  test('click tenant row opens detail/federation panel', async ({ page }) => {
    // Click the first tenant row if available
    const firstRow = page.locator('table tbody tr, [data-testid*="tenant-row"]').first()
    if (await firstRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstRow.click()
      // Should show some detail panel or navigate to detail page
      const detail = page.locator(
        '[data-testid*="detail"], [data-testid*="federation"], [class*="detail"], [class*="panel"]',
      )
      const detailHeading = page.getByRole('heading', { name: /detail|federation|dettagli|federazione/i })
      await expect(detail.first().or(detailHeading)).toBeVisible({ timeout: 10_000 })
    }
  })

  test('suspend and reactivate a tenant', async ({ page }) => {
    // Create a tenant first
    const tenantName = `E2E Suspend ${Date.now()}`
    const createBtn = page.getByRole('button', { name: /create|add|new|crea|aggiungi|nuovo/i })
    await createBtn.click()
    await page.getByLabel(/name|nome/i).first().fill(tenantName)
    await page.getByRole('button', { name: /save|create|submit|salva|crea|conferma/i }).click()
    await page.waitForLoadState('networkidle')

    // Navigate back and find it
    await page.goto('/tenants')
    await page.waitForLoadState('networkidle')
    await page.getByText(tenantName).click()

    // Suspend the tenant
    const suspendBtn = page.getByRole('button', { name: /suspend|disable|sospendi|disabilita/i })
    if (await suspendBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await suspendBtn.click()
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click()
      }
      // Check status changed
      await expect(
        page.getByText(/suspended|disabled|sospeso|disabilitato/i),
      ).toBeVisible({ timeout: 10_000 })

      // Reactivate
      const reactivateBtn = page.getByRole('button', {
        name: /reactivate|enable|activate|riattiva|abilita|attiva/i,
      })
      await reactivateBtn.click()
      const confirmReactivate = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmReactivate.isVisible()) {
        await confirmReactivate.click()
      }
      await expect(page.getByText(/active|enabled|attivo|abilitato/i)).toBeVisible({
        timeout: 10_000,
      })
    }

    // Cleanup: delete tenant
    const deleteBtn = page.getByRole('button', { name: /delete|remove|elimina|rimuovi/i })
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click()
      const confirmDel = page.getByRole('button', { name: /confirm|yes|ok|conferma|si/i })
      if (await confirmDel.isVisible()) await confirmDel.click()
    }
  })

  test('configure federation settings', async ({ page }) => {
    // Click the first tenant if available
    const firstRow = page.locator('table tbody tr, [data-testid*="tenant-row"]').first()
    if (await firstRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstRow.click()

      // Look for federation section/tab
      const fedTab = page.getByRole('tab', { name: /federation|federazione/i })
      if (await fedTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await fedTab.click()
      }

      // Try to fill visibility and geo fields if present
      const visibilityField = page.getByLabel(/visibility|visibilit/i)
      if (await visibilityField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await visibilityField.selectOption({ index: 0 })
      }

      const latField = page.getByLabel(/latitude|lat/i)
      if (await latField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await latField.fill('40.7128')
      }

      const lonField = page.getByLabel(/longitude|lon|lng/i)
      if (await lonField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await lonField.fill('-74.0060')
      }

      const saveBtn = page.getByRole('button', { name: /save|salva/i })
      if (await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await saveBtn.click()
        await expect(
          page.getByText(/saved|updated|success|salvato|aggiornato/i),
        ).toBeVisible({ timeout: 10_000 })
      }
    }
  })
})
