# Maestro Mobile UI Test Flows

Maestro YAML test flows for the four BLE platform mobile apps.

## Prerequisites

### Install Maestro

```bash
# macOS / Linux
curl -Ls "https://get.maestro.mobile.dev" | bash

# Verify installation
maestro --version
```

### Device / Emulator Setup

Maestro requires a running Android emulator or iOS simulator with the target app installed.

```bash
# Android: start emulator
emulator -avd Pixel_6_API_34

# iOS: boot simulator
xcrun simctl boot "iPhone 15 Pro"
```

### Install Apps on Device

Build and install each app before running Maestro flows:

```bash
# Consumer mobile
cd ble-consumer-mobile && npx expo run:android  # or run:ios

# Merchant mobile
cd ble-merchant-mobile && npx expo run:android

# Tenant mobile
cd ble-tenant-mobile && npx expo run:android

# Sales agent mobile
cd ble-sales-agent-mobile && npx expo run:android
```

## App IDs

| App              | Package ID           |
|------------------|----------------------|
| Consumer Mobile  | `com.ble.consumer`   |
| Merchant Mobile  | `com.ble.merchant`   |
| Tenant Mobile    | `com.ble.tenant`     |
| Sales Agent      | `com.ble.salesagent` |

## Running Flows

### Run all flows for a single app

```bash
maestro test maestro/consumer-mobile/
maestro test maestro/merchant-mobile/
maestro test maestro/tenant-mobile/
maestro test maestro/sales-agent-mobile/
```

### Run a specific flow

```bash
maestro test maestro/consumer-mobile/login.yaml
maestro test maestro/merchant-mobile/pos-scan.yaml
maestro test maestro/tenant-mobile/beacons.yaml
maestro test maestro/sales-agent-mobile/requests.yaml
```

### Run all flows across all apps

```bash
maestro test maestro/
```

## Flow Inventory

### Consumer Mobile (`maestro/consumer-mobile/`)

| Flow             | Description                                       |
|------------------|---------------------------------------------------|
| `login.yaml`     | Login with dev-consumer credentials               |
| `navigation.yaml`| Navigate through all tabs: Wallet, Discover, etc. |

### Merchant Mobile (`maestro/merchant-mobile/`)

| Flow             | Description                                       |
|------------------|---------------------------------------------------|
| `login.yaml`     | Login with dev-merchant credentials               |
| `pos-scan.yaml`  | POS barcode scan 3-step flow                      |

### Tenant Mobile (`maestro/tenant-mobile/`)

| Flow             | Description                                       |
|------------------|---------------------------------------------------|
| `login.yaml`     | Login with dev-tenant-admin credentials           |
| `beacons.yaml`   | Beacon CRUD: list, create, cancel                 |

### Sales Agent Mobile (`maestro/sales-agent-mobile/`)

| Flow             | Description                                       |
|------------------|---------------------------------------------------|
| `login.yaml`     | Login with dev-sales-agent credentials            |
| `requests.yaml`  | Registration requests list + status filters       |

## Test Credentials

| Role         | Username          | Password   |
|--------------|-------------------|------------|
| Consumer     | `dev-consumer`    | `dev-pass` |
| Merchant     | `dev-merchant`    | `dev-pass` |
| Tenant Admin | `dev-tenant-admin`| `dev-pass` |
| Sales Agent  | `dev-sales-agent` | `dev-pass` |

## Backend Requirements

The BFF gateway must be running at `http://localhost:8080` (or the Android emulator
equivalent `http://10.0.2.2:8080`) with all backing services available. Run the
seed data setup before testing:

```bash
cd ble-e2e-tests && npx playwright test --project=mobile-api --reporter=line
```

## Troubleshooting

- **App not found**: Ensure the app is installed on the emulator/simulator with
  the correct package ID.
- **Timeout on assertVisible**: Increase timeout values in the YAML flow if the
  backend is slow to respond.
- **Android emulator networking**: The apps use `10.0.2.2` to reach the host
  machine from an Android emulator. Ensure the BFF is listening on all interfaces.
