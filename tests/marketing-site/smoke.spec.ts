import { test, expect } from '@playwright/test'

/**
 * #86 — marketing-site smoke (was 0% covered). Asserts the public Astro pages
 * actually render content (not a blank/error shell) and the homepage links into
 * the key audience sections. Runs in the `marketing-site` Playwright project
 * (MARKETING_URL, default Astro preview :4321).
 */
const PAGES = ['/', '/comuni', '/consorzi', '/consumer', '/cookie-policy', '/accessibilita']

test.describe('Marketing site — smoke (#86)', () => {
  for (const path of PAGES) {
    test(`renders ${path} with content and no server error`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
      expect(res, `no response for ${path}`).toBeTruthy()
      expect(res!.status(), `${path} returned ${res!.status()}`).toBeLessThan(400)
      await expect(page).toHaveTitle(/.+/) // a real <title>, not empty
      // real content, not a blank/error shell that any URL would satisfy
      await expect(page.locator('main, h1, header').first()).toBeVisible({ timeout: 10_000 })
    })
  }

  test('homepage links into the key audience sections', async ({ page }) => {
    await page.goto('/')
    const navLink = page.locator('a[href*="comuni"], a[href*="consumer"], a[href*="consorzi"]')
    await expect(navLink.first()).toBeVisible({ timeout: 10_000 })
  })
})
