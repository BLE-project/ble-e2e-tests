import { test, expect } from '@playwright/test'
import { loginViaApi, DEV_TENANT_ID } from '../../fixtures/auth'
import { ApiClient } from '../../helpers/api-client'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const STORAGE_KEY = 'ble_tenant_token'

let territoryId: string | null = null

test.describe('Tenant Web - Campaigns', () => {
  // Ensure a territory exists for the select dropdown
  test.beforeAll(async ({ request }) => {
    const client = new ApiClient(request, BFF_URL)
    await client.login(TENANT_USER, TENANT_PASS)

    const createRes = await client.post(
      '/api/v1/territories',
      { name: `E2E Campaign Territory ${Date.now()}`, tenantId: DEV_TENANT_ID },
      { 'X-Tenant-Id': DEV_TENANT_ID },
    )
    if (createRes.ok()) {
      const body = await createRes.json()
      territoryId = body.id
    } else {
      const listRes = await client.get('/api/v1/territories', { 'X-Tenant-Id': DEV_TENANT_ID })
      if (listRes.ok()) {
        const territories = await listRes.json()
        if (Array.isArray(territories) && territories.length > 0) {
          territoryId = territories[0].id
        }
      }
    }
  })

  test.afterAll(async ({ request }) => {
    if (territoryId) {
      const client = new ApiClient(request, BFF_URL)
      await client.login(TENANT_USER, TENANT_PASS)
      await client.delete(`/api/v1/territories/${territoryId}`, { 'X-Tenant-Id': DEV_TENANT_ID }).catch(() => {})
    }
  })

  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
  })

  test('campaigns list page loads', async ({ page }) => {
    // Page heading is "Campagne" (Italian)
    const heading = page.getByRole('heading', { name: /campagne/i })
    const emptyState = page.getByText(/nessuna campagna/i)
    const table = page.locator('table')
    const list = page.locator('[data-testid*="campaign"], [class*="campaign"]')
    await expect(heading.or(emptyState).or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test.fixme('create a new campaign', async ({ page }) => {
    const campaignTitle = `E2E Campaign ${Date.now()}`

    // Click "+ Nuova campagna" button
    await page.getByRole('button', { name: /Nuova campagna/i }).click()

    // Fill "Titolo *" — find the first required text input in the form
    const titleInput = page.locator('form input[required]').first()
    await titleInput.fill(campaignTitle)

    // Territory is a required select — pick first option if available
    const territorySelect = page.locator('form select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const optionCount = await territorySelect.locator('option').count()
      if (optionCount > 1) {
        await territorySelect.selectOption({ index: 1 })
      }
    }

    // Fill "Messaggio" textarea (optional)
    const messageArea = page.locator('form textarea').first()
    if (await messageArea.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await messageArea.fill('E2E test campaign body')
    }

    // Submit with "Crea campagna" button
    await page.getByRole('button', { name: /Crea campagna/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Verify
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(campaignTitle)).toBeVisible({ timeout: 10_000 })

    // Cleanup: delete (uses window.confirm with "Elimina" button)
    page.on('dialog', dialog => dialog.accept())
    const row = page.getByText(campaignTitle).locator('..').locator('..')
    const deleteBtn = row.getByRole('button', { name: 'Elimina' })
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForLoadState('networkidle')
    }
  })

  test.fixme('delete a campaign', async ({ page }) => {
    const campaignTitle = `E2E Delete Campaign ${Date.now()}`

    // Create
    await page.getByRole('button', { name: /Nuova campagna/i }).click()
    const titleInput = page.locator('form input[required]').first()
    await titleInput.fill(campaignTitle)

    const territorySelect = page.locator('form select').first()
    if (await territorySelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const optionCount = await territorySelect.locator('option').count()
      if (optionCount > 1) await territorySelect.selectOption({ index: 1 })
    }
    await page.getByRole('button', { name: /Crea campagna/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Delete
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')

    page.on('dialog', dialog => dialog.accept())
    const row = page.getByText(campaignTitle).locator('..').locator('..')
    await row.getByRole('button', { name: 'Elimina' }).click()
    await page.waitForLoadState('networkidle')

    // Verify removed
    await page.goto('/campaigns')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(campaignTitle)).not.toBeVisible({ timeout: 10_000 })
  })
})
