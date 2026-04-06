import { APIRequestContext, expect } from '@playwright/test'

const BFF_URL = process.env.BFF_URL ?? 'http://localhost:8080'

/**
 * Shared HTTP helper that wraps Playwright's APIRequestContext with
 * pre-configured base URL and auth token injection.
 */
export class ApiClient {
  private token: string | null = null

  constructor(
    private request: APIRequestContext,
    private baseUrl: string = BFF_URL,
  ) {}

  /** Authenticate and store the JWT for subsequent calls. */
  async login(username: string, password: string): Promise<string> {
    const res = await this.request.post(`${this.baseUrl}/api/v1/auth/login`, {
      data: { username, password },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    this.token = body.token
    return this.token!
  }

  /** Refresh the current token. */
  async refresh(): Promise<string> {
    const res = await this.request.post(`${this.baseUrl}/api/v1/auth/refresh`, {
      headers: this.authHeaders(),
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    this.token = body.token
    return this.token!
  }

  /** GET with auth header. */
  async get(path: string, extraHeaders: Record<string, string> = {}) {
    return this.request.get(`${this.baseUrl}${path}`, {
      headers: { ...this.authHeaders(), ...extraHeaders },
    })
  }

  /** POST with auth header. */
  async post(path: string, data?: unknown, extraHeaders: Record<string, string> = {}) {
    return this.request.post(`${this.baseUrl}${path}`, {
      data,
      headers: { ...this.authHeaders(), ...extraHeaders },
    })
  }

  /** PUT with auth header. */
  async put(path: string, data?: unknown, extraHeaders: Record<string, string> = {}) {
    return this.request.put(`${this.baseUrl}${path}`, {
      data,
      headers: { ...this.authHeaders(), ...extraHeaders },
    })
  }

  /** DELETE with auth header. */
  async delete(path: string, extraHeaders: Record<string, string> = {}) {
    return this.request.delete(`${this.baseUrl}${path}`, {
      headers: { ...this.authHeaders(), ...extraHeaders },
    })
  }

  /** Raw POST without auth (for unauthenticated tests). */
  async rawPost(path: string, data?: unknown) {
    return this.request.post(`${this.baseUrl}${path}`, { data })
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) return {}
    return { Authorization: `Bearer ${this.token}` }
  }
}
