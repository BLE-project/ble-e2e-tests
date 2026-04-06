# BLE E2E Tests

End-to-end test suite for the BLE (Bluetooth Low Energy) loyalty platform. Tests cover the Admin Web, Tenant Web, Merchant Portal, and BFF API layer using Playwright.

## Prerequisites

- **Node.js** >= 18
- **Docker stack** running (all backend microservices + Keycloak + PostgreSQL)
- **Frontend apps** running locally:
  - Admin Web on `http://localhost:5174`
  - Tenant Web on `http://localhost:5173`
  - Merchant Portal on `http://localhost:5175`
- **BFF** running on `http://localhost:8080`
- **Keycloak** running on `http://localhost:8180` with the `ble` realm imported

## Setup

```bash
npm install
cp .env.example .env   # edit if your ports differ
```

Playwright ships with Chromium bundled. No additional browser install needed.

## Running Tests

Run the full suite:

```bash
npm test
```

Run a specific project:

```bash
npm run test:admin      # Admin Web only
npm run test:tenant     # Tenant Web only
npm run test:merchant   # Merchant Portal only
npm run test:api        # API tests only
```

Run a single spec file:

```bash
npx playwright test tests/admin-web/login.spec.ts
```

View the HTML report after a run:

```bash
npm run report
```

## Project Structure

```
ble-e2e-tests/
├── playwright.config.ts        Playwright configuration (projects, timeouts, reporters)
├── package.json                Scripts and dependencies
├── tsconfig.json               TypeScript compiler options
├── .gitignore                  Excluded files (node_modules, reports, .env)
├── .env.example                Environment variable template
├── README.md                   This file
│
├── fixtures/
│   └── auth.ts                 Shared login helpers (form, API token, Keycloak OIDC)
│
├── helpers/
│   └── api-client.ts           HTTP client wrapper with auth header injection
│
└── tests/
    ├── admin-web/              Tests for the super-admin dashboard
    │   ├── login.spec.ts       Login/logout, invalid credentials, route guards
    │   ├── tenants.spec.ts     CRUD tenants, suspend/reactivate, federation config
    │   ├── card-templates.spec.ts  CRUD card templates
    │   ├── commission-rates.spec.ts CRUD commission rates (global and per-tenant)
    │   ├── sales-agents.spec.ts    CRUD sales agents, disable, royalty section
    │   ├── navigation.spec.ts  Sidebar links, error boundary checks, user ID footer
    │   └── dsar.spec.ts        Data Subject Access Request page, search, export, delete
    │
    ├── tenant-web/             Tests for the tenant administration panel
    │   ├── login.spec.ts       Login/logout, invalid credentials, route guards
    │   ├── stores.spec.ts      CRUD stores, add/remove zones
    │   ├── campaigns.spec.ts   CRUD campaigns
    │   ├── beacons.spec.ts     CRUD beacons
    │   ├── loyalty-cards.spec.ts  Loyalty cards list
    │   ├── users.spec.ts       CRUD merchant users, disable
    │   ├── analytics.spec.ts   Tenant and merchant analytics, period selector
    │   └── navigation.spec.ts  Sidebar links, error boundary checks
    │
    ├── merchant-portal/        Tests for the merchant-facing portal (OIDC auth)
    │   ├── login.spec.ts       Keycloak redirect, OIDC login, token persistence
    │   ├── beacon-groups.spec.ts  CRUD beacon groups
    │   └── navigation.spec.ts  Dashboard, beacon groups link
    │
    └── api/                    Pure API tests (no browser)
        ├── auth.spec.ts        Login, invalid login, empty body, refresh, all dev users
        └── proxy-routing.spec.ts  Verify each proxy segment reaches the correct service
```

## How to Add New Tests

1. Create a new `.spec.ts` file in the appropriate `tests/<project>/` directory.
2. Import the shared auth fixture that matches your app:
   - `loginViaForm` for admin-web and tenant-web
   - `loginViaApi` for fast token injection (skips UI login)
   - `loginViaKeycloak` for merchant-portal (OIDC flow)
3. Use `test.beforeEach` to authenticate before each test.
4. Clean up any data you create (delete after test or in `test.afterEach`).
5. Run with `npx playwright test tests/<project>/<your-file>.spec.ts`.

## Dev User Credentials

These users are seeded from `realm-ble.json` in the Keycloak dev realm:

| Username          | Password  | Role              |
|-------------------|-----------|-------------------|
| dev-super-admin   | dev-pass  | Super Admin       |
| dev-tenant-admin  | dev-pass  | Tenant Admin      |
| dev-merchant      | dev-pass  | Merchant          |
| dev-consumer      | dev-pass  | Consumer          |
| dev-sales-agent   | dev-pass  | Sales Agent       |

## Configuration

All URLs and credentials are configurable via environment variables. Copy `.env.example` to `.env` and adjust as needed.

| Variable          | Default                    | Description                  |
|-------------------|----------------------------|------------------------------|
| ADMIN_URL         | http://localhost:5174      | Admin Web base URL           |
| TENANT_URL        | http://localhost:5173      | Tenant Web base URL          |
| MERCHANT_URL      | http://localhost:5175      | Merchant Portal base URL     |
| BFF_URL           | http://localhost:8080      | BFF gateway base URL         |
| KC_URL            | http://localhost:8180      | Keycloak base URL            |
| KC_REALM          | ble                        | Keycloak realm name          |

## Token Storage

Each frontend stores its JWT differently:

- **Admin Web**: `localStorage` key `ble_admin_token`
- **Tenant Web**: `localStorage` key `ble_tenant_token`
- **Merchant Portal**: managed by `oidc-client-ts` (sessionStorage, `oidc.user:*` keys)
