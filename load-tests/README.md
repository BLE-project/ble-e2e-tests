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
Ramp-up load test — establishes performance baselines under moderate load.
- 15s warm-up to 5 VUs
- 30s ramp to 20 VUs
- 60s sustain at 50 VUs
- 15s cool-down to 0

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

### spike-test.js
Simulates a sudden traffic surge — tests platform resilience to spikes.
- 10s spike from 0 to 200 VUs
- 30s sustain at peak (200 VUs)
- 10s drop to 0

**Endpoints tested:**
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /gateway/health` | No | Liveness check |
| `GET /api/v1/tenants` | Bearer | Authenticated list |
| `POST /api/v1/auth/login` | No | Token exchange |
| `GET /api/v1/stores` | Bearer | Store listing |

**Thresholds:**
| Metric | Threshold | Description |
|--------|-----------|-------------|
| `http_req_duration p(95)` | < 2000ms | Relaxed for spike |
| `http_req_failed` | < 10% | Allow higher error rate during spike |

### soak-test.js
Long-duration test — detects memory leaks, connection pool exhaustion, and gradual degradation.
- 30s ramp to 20 VUs
- 5 minutes sustained at 20 VUs
- 30s ramp down to 0

**Endpoints tested:**
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /gateway/health` | No | Liveness check |
| `GET /api/v1/tenants` | Bearer | Authenticated list |
| `POST /api/v1/auth/login` | No | Token exchange |
| `GET /api/v1/stores` | Bearer | Store listing |
| `GET /api/v1/badges/{tenantId}` | Bearer | Gamification endpoint |

**Thresholds:**
| Metric | Threshold | Description |
|--------|-----------|-------------|
| `http_req_duration p(95)` | < 500ms | Must stay fast over time |
| `http_req_failed` | < 1% | No degradation over time |

### stress-test.js
Progressive stress test — finds the breaking point of the platform.
- 30s ramp to 50 VUs
- 30s ramp to 100 VUs
- 30s ramp to 200 VUs
- 30s ramp to 300 VUs (peak)
- 1m recovery to 0

**Endpoints tested:**
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /gateway/health` | No | Liveness check |
| `GET /api/v1/tenants` | Bearer | Authenticated list |
| `POST /api/v1/auth/login` | No | Token exchange |
| `GET /api/v1/stores` | Bearer | Store listing |
| `GET /api/v1/events` | Bearer | Event ingestion |
| `GET /api/v1/badges/{tenantId}` | Bearer | Gamification endpoint |

**Thresholds:**
| Metric | Threshold | Description |
|--------|-----------|-------------|
| `http_req_duration p(95)` | < 3000ms | Relaxed — goal is to find limit |

## Dev Credentials
| User | Password | Role |
|------|----------|------|
| dev-super-admin | dev-pass | SUPER_ADMIN |
