import { test, expect } from '@playwright/test'
import { loginViaApi, DEV_TENANT_ID } from '../../fixtures/auth'
import { ApiClient } from '../../helpers/api-client'

const TENANT_USER = process.env.TENANT_USER ?? 'dev-tenant-admin'
const TENANT_PASS = process.env.TENANT_PASS ?? 'dev-pass'
const BASE_URL = process.env.TENANT_URL ?? 'http://localhost:5173'
const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'
const STORAGE_KEY = 'ble_tenant_token'

test.describe('Tenant Web - Beacons', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, BASE_URL, TENANT_USER, TENANT_PASS, STORAGE_KEY)
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')
  })

  test('beacons list page loads', async ({ page }) => {
    // Heading is "Beacon Registry"
    const heading = page.getByRole('heading', { name: /beacon/i })
    const emptyState = page.getByText(/no beacons/i)
    const table = page.locator('table')
    const list = page.locator('[data-testid*="beacon"], [class*="beacon"]')
    await expect(heading.or(emptyState).or(table).or(list).first()).toBeVisible({ timeout: 10_000 })
  })

  test.fixme('create a new beacon', async ({ page }) => {
    const beaconLabel = `E2E Beacon ${Date.now()}`
    const ts = Date.now()

    // Click "+ Add beacon" button
    await page.getByRole('button', { name: /Add beacon/i }).click()

    // Fill form fields — the BeaconsPage generates inputs from an array:
    // [uuid, UUID, text], [major, Major, number], [minor, Minor, number], [label, Label (optional), text]
    // We use the label text to locate inputs
    const form = page.locator('form')
    await expect(form).toBeVisible({ timeout: 5_000 })

    // UUID input
    const uuidLabel = form.locator('label').filter({ hasText: /^UUID$/ })
    const uuidInput = uuidLabel.locator('..').locator('input')
    await uuidInput.fill(`550e8400-e29b-${ts.toString(16).slice(0, 4)}-a716-446655440000`)

    // Major input
    const majorLabel = form.locator('label').filter({ hasText: /^Major$/ })
    const majorInput = majorLabel.locator('..').locator('input')
    await majorInput.clear()
    await majorInput.fill('1')

    // Minor input
    const minorLabel = form.locator('label').filter({ hasText: /^Minor$/ })
    const minorInput = minorLabel.locator('..').locator('input')
    await minorInput.clear()
    await minorInput.fill('1')

    // Label (optional) input
    const labelLbl = form.locator('label').filter({ hasText: /Label \(optional\)/i })
    const labelInput = labelLbl.locator('..').locator('input')
    await labelInput.fill(beaconLabel)

    // Submit with "Create beacon" button
    await page.getByRole('button', { name: /Create beacon/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Verify — the beacon shows UUID in the list, and label as subtitle
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')

    // The beacon may or may not have been created depending on API requirements
    const beaconVisible = await page.getByText(beaconLabel).isVisible({ timeout: 10_000 }).catch(() => false)
    expect(beaconVisible).toBeTruthy()

    // Cleanup: delete (uses window.confirm with "Delete" button)
    if (beaconVisible) {
      page.on('dialog', dialog => dialog.accept())
      const beaconRow = page.getByText(beaconLabel).locator('..').locator('..')
      const deleteBtn = beaconRow.getByRole('button', { name: 'Delete' })
      if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await deleteBtn.click()
        await page.waitForLoadState('networkidle')
      }
    }
  })

  test.fixme('delete a beacon', async ({ page }) => {
    const beaconLabel = `E2E Delete Beacon ${Date.now()}`
    const ts = Date.now()

    // Create
    await page.getByRole('button', { name: /Add beacon/i }).click()
    const form = page.locator('form')
    await expect(form).toBeVisible({ timeout: 5_000 })

    const uuidInput = form.locator('label').filter({ hasText: /^UUID$/ }).locator('..').locator('input')
    await uuidInput.fill(`660e8400-e29b-${ts.toString(16).slice(0, 4)}-a716-446655440000`)

    const majorInput = form.locator('label').filter({ hasText: /^Major$/ }).locator('..').locator('input')
    await majorInput.clear()
    await majorInput.fill('2')

    const minorInput = form.locator('label').filter({ hasText: /^Minor$/ }).locator('..').locator('input')
    await minorInput.clear()
    await minorInput.fill('2')

    const labelInput = form.locator('label').filter({ hasText: /Label \(optional\)/i }).locator('..').locator('input')
    await labelInput.fill(beaconLabel)

    await page.getByRole('button', { name: /Create beacon/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)

    // Delete
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')

    page.on('dialog', dialog => dialog.accept())
    const beaconRow = page.getByText(beaconLabel).locator('..').locator('..')
    await beaconRow.getByRole('button', { name: 'Delete' }).click()
    await page.waitForLoadState('networkidle')

    // Verify removed
    await page.goto('/beacons')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(beaconLabel)).not.toBeVisible({ timeout: 10_000 })
  })
})
