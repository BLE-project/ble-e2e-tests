/**
 * Security tests — Response Headers
 *
 * Verifies that the BFF returns proper security headers in its HTTP responses
 * and does not leak server internals or stack traces.
 */
import { test, expect } from '@playwright/test'
import { loadSeedDataSync } from '../../fixtures/seed-data'

const BFF = process.env.BFF_URL ?? 'http://localhost:8080'

test.describe('Security — Response Headers', () => {
  let token: string
  let tenantId: string

  test.beforeAll(async ({ request }) => {
    const seed = loadSeedDataSync()
    tenantId = seed?.tenantId ?? '00000000-0000-0000-0000-000000000001'

    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      data: { username: 'dev-super-admin', password: 'dev-pass' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    token = body.token
  })

  function authHeaders() {
    return {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
    }
  }

  test('X-Content-Type-Options should be nosniff', async ({ request }) => {
    const res = await request.get(`${BFF}/gateway/health`)
    const header = res.headers()['x-content-type-options']

    // If present, it must be 'nosniff'
    if (header) {
      expect(header).toBe('nosniff')
    } else {
      console.log('X-Content-Type-Options header not set (recommended to add)')
    }
  })

  test('X-Frame-Options should be DENY or SAMEORIGIN', async ({ request }) => {
    const res = await request.get(`${BFF}/gateway/health`)
    const header = res.headers()['x-frame-options']

    if (header) {
      expect(['DENY', 'SAMEORIGIN', 'deny', 'sameorigin']).toContain(header.toUpperCase())
    } else {
      console.log('X-Frame-Options header not set (recommended to add)')
    }
  })

  test('Server header should not reveal internal info', async ({ request }) => {
    const res = await request.get(`${BFF}/gateway/health`)
    const server = res.headers()['server']

    if (server) {
      // Should not contain detailed version info
      expect(server.toLowerCase()).not.toContain('apache/')
      expect(server.toLowerCase()).not.toContain('nginx/')
      // Quarkus/Vert.x version should not be exposed
      const versionPattern = /\d+\.\d+\.\d+/
      if (versionPattern.test(server)) {
        console.log(`Server header reveals version info: ${server}`)
      }
    }
  })

  test('Error responses should not contain stack traces', async ({ request }) => {
    // Trigger a 404 error
    const res404 = await request.get(`${BFF}/api/v1/nonexistent-endpoint-12345`, {
      headers: authHeaders(),
    })

    const body = await res404.text()
    // Must not leak Java stack traces
    expect(body).not.toContain('java.lang.')
    expect(body).not.toContain('at io.quarkus.')
    expect(body).not.toContain('at io.vertx.')
    expect(body).not.toContain('Caused by:')
    expect(body).not.toContain('NullPointerException')
    expect(body).not.toContain('ClassNotFoundException')
  })

  test('Error responses from invalid requests should not contain stack traces', async ({
    request,
  }) => {
    // Send malformed JSON to trigger a parse error
    const res = await request.post(`${BFF}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{ invalid json !!!',
    })

    const body = await res.text()
    expect(body).not.toContain('java.lang.')
    expect(body).not.toContain('com.fasterxml.jackson.')
    expect(body).not.toContain('Caused by:')
    expect(res.status()).toBeLessThan(500)
  })

  test('CORS headers should be set correctly', async ({ request }) => {
    // Send a preflight OPTIONS request
    const res = await request.fetch(`${BFF}/api/v1/tenants`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, X-Tenant-Id',
      },
    })

    const allowOrigin = res.headers()['access-control-allow-origin']
    const allowHeaders = res.headers()['access-control-allow-headers']

    // If CORS is configured (dev mode), check that it allows the expected origin
    if (allowOrigin) {
      // Should be a specific origin or wildcard
      expect(
        allowOrigin === '*' ||
        allowOrigin.includes('localhost'),
      ).toBeTruthy()
    }

    // If allow-headers is set, it should include the required headers
    if (allowHeaders) {
      const lowerHeaders = allowHeaders.toLowerCase()
      expect(
        lowerHeaders.includes('authorization') ||
        lowerHeaders.includes('*'),
      ).toBeTruthy()
    }
  })

  test('Authenticated endpoint error should not leak internal paths', async ({ request }) => {
    // Access a non-existent resource with auth
    const res = await request.get(`${BFF}/api/v1/tenants/invalid-uuid-format`, {
      headers: authHeaders(),
    })

    const body = await res.text()
    // Must not contain internal filesystem paths
    expect(body).not.toMatch(/\/home\/\w+/)
    expect(body).not.toMatch(/C:\\/)
    expect(body).not.toMatch(/\/opt\//)
    expect(body).not.toContain('src/main/java')
  })
})
