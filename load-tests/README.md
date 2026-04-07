# BLE Platform — Load Tests (k6)

Performance and load testing using [k6](https://k6.io).

## Prerequisites

1. **Docker stack running** — all 20 services healthy
2. **k6 installed**:
   ```bash
   # Windows (via winget)
   winget install k6

   # macOS
   brew install k6

   # Linux
   sudo gpg -k
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
     sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update && sudo apt-get install k6
   ```

## Running

```bash
# Default (localhost:8080)
k6 run load-tests/baseline.js

# Against staging
k6 run --env BFF_URL=http://staging-bff:8080 load-tests/baseline.js

# With HTML report (requires k6 extension)
K6_WEB_DASHBOARD=true k6 run load-tests/baseline.js
```

## Test Scenarios

### baseline.js
Ramp-up load test:
- 15s warm-up → 5 VUs
- 30s ramp → 20 VUs
- 60s sustain → 50 VUs
- 15s cool-down → 0

**Endpoints tested:**
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /gateway/health` | No | Liveness check |
| `GET /api/v1/tenants` | Bearer | Authenticated list |
| `POST /api/v1/auth/login` | No | Token exchange |

**Thresholds:**
| Metric | Threshold | Description |
|--------|-----------|-------------|
| `http_req_duration p(95)` | < 500ms | 95th percentile response time |
| `http_req_duration p(99)` | < 1000ms | 99th percentile |
| `http_req_failed` | < 1% | Error rate |

## Dev Credentials
| User | Password | Role |
|------|----------|------|
| dev-super-admin | dev-pass | SUPER_ADMIN |
