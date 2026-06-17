import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30_000,
  use: {
    baseURL: process.env.ADMIN_URL ?? 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'smoke',
      testDir: './tests/smoke',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
    {
      name: 'admin-web',
      testDir: './tests/admin-web',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_URL ?? 'http://localhost:5174',
      },
    },
    {
      name: 'tenant-web',
      testDir: './tests/tenant-web',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.TENANT_URL ?? 'http://localhost:5173',
      },
    },
    {
      name: 'merchant-portal',
      testDir: './tests/merchant-portal',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.MERCHANT_URL ?? 'http://localhost:5175',
      },
    },
    {
      // #86 — marketing-site (Astro, public). Default Astro preview port 4321.
      name: 'marketing-site',
      testDir: './tests/marketing-site',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.MARKETING_URL ?? 'http://localhost:4321',
      },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
    {
      name: 'mobile-api',
      testDir: './tests/mobile-api',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
    {
      name: 'security',
      testDir: './tests/security',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
    {
      name: 'beacon-real',
      testDir: './tests/beacon-real',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
    {
      name: 'beacon-management',
      testDir: './tests/beacon-management',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
    {
      name: 'territory-isolation',
      testDir: './tests/territory-isolation',
      use: {
        baseURL: process.env.BFF_URL ?? 'http://localhost:8080',
      },
    },
  ],
})
