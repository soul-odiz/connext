# Connext - Production Deployment Guide

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React SPA  │────▶│  Flask API   │────▶│  PostgreSQL  │
│  (nginx:80)  │     │ (Gunicorn    │     │   (Azure)    │
│              │     │  + Eventlet) │     │             │
│  Azure       │     │  :5000       │     │             │
│  Container   │     │  Azure Cont. │     │             │
│  App         │     │  App         │     └─────────────┘
└─────────────┘     └──────┬───────┘
                           │
                    ┌──────▼───────┐    ┌──────────────┐
                    │    Redis      │    │  Blob Storage │
                    │  (rate limit  │    │  (user images)│
                    │   + caching)  │    │              │
                    │   Azure       │    │   Azure      │
                    └──────────────┘    └──────────────┘
```

## Pre-Flight Checks (Run Before Deploying)

```bash
# 1. Install dev dependencies and run backend tests
python -m pip install -r src/requirements-dev.txt
python -m pytest src/tests -v
# Expected: 49 passed

# 2. Run frontend tests
npm --prefix connextproj test -- --watchAll=false --runInBand
# Expected: 3 test suites, 6 tests passed

# 3. Generate secure random secrets for production (SAVE THESE!):
python -c "import secrets; print('JWT_SECRET_KEY:', secrets.token_hex(64))"
python -c "import secrets; print('SECRET_KEY:', secrets.token_hex(64))"

# 4. Test full stack locally with PostgreSQL + Redis:
docker-compose up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:5000
# Health:   curl http://localhost:5000/health
# Readiness: curl http://localhost:5000/ready
docker-compose down   # stop when done
```

## Phase 1 – Create Azure Infrastructure (One-Time)

```bash
# Login
az login

# ---- Variables (customize these) ----
SET RESOURCE_GROUP=connext-rg
SET LOCATION=germanywestcentral
SET ACR_NAME=connextregistry        # must be globally unique, lowercase
SET POSTGRES_SERVER=connext-db       # must be globally unique, lowercase
SET DB_PASSWORD=YourSuperSecurePass123!
SET STORAGE_NAME=connextstorage      # must be globally unique, lowercase (3-24 chars)

# ---- 1a. Resource Group ----
az group create --name %RESOURCE_GROUP% --location %LOCATION%

# ---- 1b. Container Registry ----
az acr create --resource-group %RESOURCE_GROUP% --name %ACR_NAME% --sku Basic --admin-enabled true

# ---- 1c. PostgreSQL Flexible Server + Database ----
az postgres flexible-server create ^
  --resource-group %RESOURCE_GROUP% ^
  --name %POSTGRES_SERVER% ^
  --admin-user connext_admin ^
  --admin-password "%DB_PASSWORD%" ^
  --sku-name Standard_B1ms ^
  --tier Burstable ^
  --storage-size 32 ^
  --public-access 0.0.0.0

az postgres flexible-server db create ^
  --resource-group %RESOURCE_GROUP% ^
  --server-name %POSTGRES_SERVER% ^
  --database-name connextdb

# ---- 1d. Redis for Rate Limiting ----
az redis create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-redis ^
  --location %LOCATION% ^
  --sku Basic ^
  --vm-size C0 ^
  --enable-non-ssl-port

# Get Redis connection details (save these)
az redis list-keys --resource-group %RESOURCE_GROUP% --name connext-redis --query primaryKey -o tsv
az redis show --resource-group %RESOURCE_GROUP% --name connext-redis --query hostName -o tsv
az redis show --resource-group %RESOURCE_GROUP% --name connext-redis --query sslPort -o tsv
# REDIS_URL format: rediss://:PRIMARY_KEY@HOSTNAME:SSL_PORT/0
# Example: rediss://:AbCd1234...@connext-redis.redis.cache.windows.net:6380/0

# ---- 1e. Blob Storage for User Uploads ----
az storage account create ^
  --resource-group %RESOURCE_GROUP% ^
  --name %STORAGE_NAME% ^
  --location %LOCATION% ^
  --sku Standard_LRS

az storage container create ^
  --account-name %STORAGE_NAME% ^
  --name connext-uploads ^
  --public-access off

# Get storage connection string (save this)
az storage account show-connection-string ^
  --resource-group %RESOURCE_GROUP% ^
  --name %STORAGE_NAME% ^
  --query connectionString -o tsv

# ---- 1f. Container Apps Environment ----
az containerapp env create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-env ^
  --location %LOCATION%
```

## Phase 2 – Build & Push Docker Images

```bash
# Login to ACR
az acr login --name %ACR_NAME%

# ---- Build BACKEND image ----
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-backend:latest ^
  --file src/Dockerfile ^
  src/

# ---- Build FRONTEND image ----
# NOTE: REACT_APP_API_BASE_URL is baked into the JS bundle at build time.
# You MUST deploy the backend FIRST to get its FQDN, then rebuild the frontend.
# For initial build, use a placeholder. Rebuild after backend is deployed.
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-frontend:latest ^
  --build-arg REACT_APP_API_BASE_URL=https://PLACEHOLDER_BACKEND_FQDN ^
  --file connextproj/Dockerfile ^
  connextproj/
```

## Phase 3 – Deploy Backend

Gather all these values first:

| Variable | Source |
|---|---|
| DB_PASSWORD | You set in Phase 1 |
| POSTGRES_SERVER | e.g., `connext-db` |
| JWT_SECRET_KEY | Generated in pre-flight (token_hex 64) |
| SECRET_KEY | Generated in pre-flight (token_hex 64) |
| REDIS_URL | `rediss://:PRIMARY_KEY@HOSTNAME:6380/0` from Phase 1d |
| STORAGE_CONN_STR | From Phase 1e |
| SENTRY_DSN | From sentry.io (optional, leave empty to disable) |

```sql_command
SET DB_URL=postgresql://connext_admin:%DB_PASSWORD%@%POSTGRES_SERVER%.postgres.database.azure.com:5432/connextdb
SET JWT_KEY=your_128_char_hex_here
SET SECRET_KEY=your_other_128_char_hex_here
SET REDIS_URL=rediss://:YOUR_REDIS_KEY@connext-redis.redis.cache.windows.net:6380/0
SET STORAGE_KEY=DefaultEndpointsProtocol=https;AccountName=connextstorage;AccountKey=YOUR_KEY;EndpointSuffix=core.windows.net
```

```bash
az containerapp create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --environment connext-env ^
  --image %ACR_NAME%.azurecr.io/connext-backend:latest ^
  --registry-server %ACR_NAME%.azurecr.io ^
  --target-port 5000 ^
  --ingress external ^
  --transport auto ^
  --min-replicas 1 ^
  --max-replicas 3 ^
  --cpu 0.5 ^
  --memory 1.0Gi ^
  --env-vars ^
    DATABASE_URL="%DB_URL%" ^
    JWT_SECRET_KEY="%JWT_KEY%" ^
    SECRET_KEY="%SECRET_KEY%" ^
    CORS_ORIGINS="https://connext-frontend.YOUR_ENV_ID.%LOCATION%.azurecontainerapps.io,http://localhost:3000" ^
    REDIS_URL="%REDIS_URL%" ^
    FLASK_ENV=production ^
    FLASK_DEBUG=0 ^
    LOG_LEVEL=INFO ^
    DB_POOL_SIZE=10 ^
    DB_POOL_RECYCLE=300 ^
    DB_MAX_OVERFLOW=20 ^
    MAX_UPLOAD_SIZE_MB=10 ^
    UPLOAD_PROVIDER=azure_blob ^
    AZURE_STORAGE_CONNECTION_STRING="%STORAGE_KEY%" ^
    AZURE_STORAGE_CONTAINER=connext-uploads ^
    GEOCOPY_USER_AGENT="ConnextApp/1.0 (your.email@example.com)" ^
    RATE_LIMIT_DEFAULT="200 per day, 50 per hour" ^
    RATE_LIMIT_REGISTER="10 per hour" ^
    RATE_LIMIT_LOGIN="20 per hour" ^
    RATE_LIMIT_UPLOAD="10 per hour" ^
    RATE_LIMIT_MESSAGE="60 per minute" ^
    SOCKETIO_ASYNC_MODE=eventlet ^
    REQUIRE_SOCKET_AUTH=true ^
    SENTRY_DSN="" ^
    SENTRY_TRACES_SAMPLE_RATE=0.1
```

```bash
# Run database migrations
az containerapp exec ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --command "flask db upgrade"
```

```bash
# Get backend FQDN (needed for frontend build)
az containerapp show ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --query properties.configuration.ingress.fqdn ^
  -o tsv
```

```bash
# Verify backend
curl https://<BACKEND_FQDN>/health
# Expected: {"status":"healthy","timestamp":"...","version":"1.0.0"}
curl https://<BACKEND_FQDN>/ready
# Expected: {"status":"ready","database":"connected","timestamp":"..."}
```

## Phase 4 – Deploy Frontend (After Backend is Running)

Now that you have the backend FQDN, rebuild the frontend with the correct API URL:

```bash
# Rebuild frontend with real backend URL
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-frontend:latest ^
  --build-arg REACT_APP_API_BASE_URL=https://<ACTUAL_BACKEND_FQDN> ^
  --file connextproj/Dockerfile ^
  connextproj/
```

```bash
# Deploy frontend
az containerapp create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-frontend ^
  --environment connext-env ^
  --image %ACR_NAME%.azurecr.io/connext-frontend:latest ^
  --registry-server %ACR_NAME%.azurecr.io ^
  --target-port 80 ^
  --ingress external ^
  --transport auto ^
  --min-replicas 1 ^
  --max-replicas 3 ^
  --cpu 0.25 ^
  --memory 0.5Gi
```

```bash
# Get frontend FQDN
az containerapp show ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-frontend ^
  --query properties.configuration.ingress.fqdn ^
  -o tsv
```

## Phase 5 – Update CORS (Final Step)

Now that you have BOTH URLs, update the backend's CORS_ORIGINS:

```bash
az containerapp update ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --set-env-vars CORS_ORIGINS="https://<FRONTEND_FQDN>,http://localhost:3000"
```

## Monitoring

- **Health**: `https://<backend-fqdn>/health`
- **Readiness**: `https://<backend-fqdn>/ready`
- **Logs**: `az containerapp logs show --resource-group %RESOURCE_GROUP% --name connext-backend --follow`

### Sentry Error Monitoring (Optional)

1. Create a **Python / Flask** project at [sentry.io](https://sentry.io)
2. Copy the DSN into `SENTRY_DSN` env var on the backend Container App
3. Set `SENTRY_TRACES_SAMPLE_RATE` (0.0 = errors only, 0.1 = 10% of transactions)
4. Redeploy: `az containerapp update --name connext-backend --resource-group %RESOURCE_GROUP% --set-env-vars SENTRY_DSN="<your-dsn>"`
5. Verify logs show: `Sentry error monitoring initialized`

## Quick Reference: All Azure Resources

| Resource | Name | Purpose |
|---|---|---|
| Resource Group | `connext-rg` | Contains everything |
| Container Registry | `connextregistry` | Docker images |
| PostgreSQL | `connext-db` | Primary database |
| Redis | `connext-redis` | Rate limiting |
| Storage Account | `connextstorage` | User profile images |
| Container Env | `connext-env` | Hosting environment |
| Container App | `connext-backend` | Flask API (port 5000) |
| Container App | `connext-frontend` | React SPA (port 80) |

## Security Checklist

- [ ] JWT_SECRET_KEY is a random 128-char hex string
- [ ] SECRET_KEY is a random 128-char hex string
- [ ] Database password is strong
- [ ] CORS_ORIGINS is set to your actual frontend FQDN (not wildcard)
- [ ] HTTPS is enabled (Azure Container Apps does this automatically)
- [ ] FLASK_DEBUG=0 and FLASK_ENV=production
- [ ] Database is PostgreSQL (NOT SQLite)
- [ ] UPLOAD_PROVIDER is set to azure_blob (NOT local)
- [ ] Redis is configured for rate limiting (REDIS_URL uses rediss:// for SSL)
- [ ] REQUIRE_SOCKET_AUTH is set to true
- [ ] SENTRY_DSN is stored as an env var, never committed to Git
- [ ] All secrets are set via Azure env vars, NOT in code or .env files

## Key Production Notes

1. **WebSocket support**: The `--transport auto` flag is **critical**. Without it, SocketIO connections fail.
2. **Single worker**: The Dockerfile uses `--workers 1` because Eventlet + multiple workers breaks SocketIO sticky sessions. Scale via replicas (--min-replicas / --max-replicas).
3. **Redis SSL**: Azure Cache for Redis requires SSL on port 6380. The URL must use `rediss://` scheme.
4. **Eventlet**: Pinned to 0.36.1 for Python 3.12 compatibility. Earlier versions crash with `AttributeError: module 'ssl' has no attribute 'wrap_socket'`.
5. **Frontend rebuild**: The `REACT_APP_API_BASE_URL` is baked into the JS bundle. You must rebuild and redeploy the frontend whenever the backend URL changes.
6. **Deploy order**: Backend first → get its FQDN → rebuild frontend with that FQDN → deploy frontend → update backend CORS.

## Scaling

- Increase `--max-replicas` for more instances
- Add pgBouncer for connection pooling above 3 backend replicas
- Consider Azure Front Door CDN for static asset caching
- For high-traffic matching, consider Redis pub/sub for queue management

## Automated Tests

```bash
# Backend (49 tests)
python -m pip install -r src/requirements-dev.txt
python -m pytest src/tests -v

# Frontend (6 tests, 3 suites)
npm --prefix connextproj test -- --watchAll=false --runInBand