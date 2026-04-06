import { test, expect } from '@playwright/test'
import { ApiClient } from '../../helpers/api-client'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

// All 7 dev users from realm-ble.json
const DEV_USERS = [
  { username: process.env.ADMIN_USER ?? 'dev-super-admin', password: process.env.ADMIN_PASS ?? 'dev-pass' },
  { username: process.env.TENANT_USER ?? 'dev-tenant-admin', password: process.env.TENANT_PASS ?? 'dev-pass' },
  { username: process.env.MERCHANT_USER ?? 'dev-merchant', password: process.env.MERCHANT_PASS ?? 'dev-pass' },
  { username: process.env.CONSUMER_USER ?? 'dev-consumer', password: process.env.CONSUMER_PASS ?? 'dev-pass' },
  { username: process.env.SALES_AGENT_USER ?? 'dev-sales-agent', password: process.env.SALES_AGENT_PASS ?? 'dev-pass' },
]

test.describe('API - Auth', () => {
  test('POST /api/v1/auth/login with valid credentials returns 200 and token', async ({
    request,
  }) => {
    const response = await request.post(`${BFF_URL}/api/v1/auth/login`, {
      data: {
        username: DEV_USERS[0].username,
        password: DEV_USERS[0].password,
      },
    })

    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('token')
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
  })

  test('POST /api/v1/auth/login with invalid credentials returns 401', async ({
    request,
  }) => {
    const response = await request.post(`${BFF_URL}/api/v1/auth/login`, {
      data: {
        username: 'non-existent-user',
        password: 'wrong-password',
      },
    })

    expect(response.status()).toBe(401)
  })

  test('POST /api/v1/auth/login without body returns 400', async ({ request }) => {
    const response = await request.post(`${BFF_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
    })

    // Should be 400 Bad Request (or 422 Unprocessable Entity)
    expect([400, 422]).toContain(response.status())
  })

  test('POST /api/v1/auth/refresh with valid token returns 200 and new token', async ({
    request,
  }) => {
    // First login to get a token
    const loginResponse = await request.post(`${BFF_URL}/api/v1/auth/login`, {
      data: {
        username: DEV_USERS[0].username,
        password: DEV_USERS[0].password,
      },
    })
    expect(loginResponse.ok()).toBeTruthy()
    const { token } = await loginResponse.json()

    // Now refresh
    const refreshResponse = await request.post(`${BFF_URL}/api/v1/auth/refresh`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(refreshResponse.status()).toBe(200)
    const refreshBody = await refreshResponse.json()
    expect(refreshBody).toHaveProperty('token')
    expect(typeof refreshBody.token).toBe('string')
    expect(refreshBody.token.length).toBeGreaterThan(0)
  })

  for (const user of DEV_USERS) {
    test(`dev user "${user.username}" can login successfully`, async ({ request }) => {
      const response = await request.post(`${BFF_URL}/api/v1/auth/login`, {
        data: {
          username: user.username,
          password: user.password,
        },
      })

      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body).toHaveProperty('token')
      expect(typeof body.token).toBe('string')
      expect(body.token.length).toBeGreaterThan(0)
    })
  }
})
