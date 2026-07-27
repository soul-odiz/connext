connext

links:
frontend
"https://connextfront.kindmoss-4634ec14.germanywestcentral.azurecontainerapps.io"
backend
"https://connextcloud.kindmoss-4634ec14.germanywestcentral.azurecontainerapps.io"


TODO production:

Task Completed

Complete Command Reference – Docker Build & Azure Deployment for Connext
PHASE 1 – Pre-Flight Checks (Before Docker/Upload)
Run these locally to confirm everything works:


# Run backend tests (uses isolated SQLite, no DB needed)
python -m pip install -r src/requirements-dev.txt
python -m pytest src/tests -v

# Run frontend tests
npm --prefix connextproj test -- --watchAll=false --runInBand


# Generate secure random strings for production secrets
python -c "import secrets; print('JWT_SECRET_KEY:', secrets.token_hex(64))"
python -c "import secrets; print('SECRET_KEY:', secrets.token_hex(64))"

# Test full stack locally with PostgreSQL + Redis (mimics production)
# Requires Docker Desktop running
docker-compose up --build

# Verify:
#   Frontend: http://localhost:3000
#   Backend health:  curl http://localhost:5000/health
#   Backend readiness: curl http://localhost:5000/ready

# Stop when done
docker-compose down
PHASE 2 – Azure Infrastructure (One-Time Setup)

# Login to Azure
az login

# Set variables (customize these)
SET RESOURCE_GROUP=connext-rg
SET LOCATION=germanywestcentral
SET ACR_NAME=connextregistry    # must be globally unique
SET POSTGRES_SERVER=connext-db   # must be globally unique
SET DB_PASSWORD=YourSuperSecurePassword123!

# Create Resource Group
az group create --name %RESOURCE_GROUP% --location %LOCATION%

# Create Container Registry (stores your Docker images)
az acr create --resource-group %RESOURCE_GROUP% --name %ACR_NAME% --sku Basic --admin-enabled true

# Create PostgreSQL Flexible Server + database
az postgres flexible-server create ^
  --resource-group %RESOURCE_GROUP% ^
  --name %POSTGRES_SERVER% ^
  --admin-user connext_admin ^
  --admin-password "%DB_PASSWORD%" ^
  --sku-name Standard_B1ms ^
  --tier Burstable ^
  --storage-size 32 ^
  --public-access 0.0.0.0   & REM allows Azure services to connect

az postgres flexible-server db create ^
  --resource-group %RESOURCE_GROUP% ^
  --server-name %POSTGRES_SERVER% ^
  --database-name connextdb

# Create Redis (for rate limiting across replicas)
az redis create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-redis ^
  --location %LOCATION% ^
  --sku Basic ^
  --vm-size C0 ^
  --enable-non-ssl-port

# Get Redis connection string (you'll need this for env vars)
az redis list-keys --resource-group %RESOURCE_GROUP% --name connext-redis --query primaryKey -o tsv

# Create Storage Account + Blob Container (for user profile images)
az storage account create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connextstorage        & REM must be globally unique, lowercase only ^
  --location %LOCATION% ^
  --sku Standard_LRS

az storage container create ^
  --account-name connextstorage ^
  --name connext-uploads ^
  --public-access off

# Get storage connection string
az storage account show-connection-string ^
  --resource-group %RESOURCE_GROUP% ^
  --name connextstorage ^
  --query connectionString -o tsv

# Create Container Apps Environment
az containerapp env create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-env ^
  --location %LOCATION%
PHASE 3 – Build & Push Docker Images

# Login to ACR
az acr login --name %ACR_NAME%

# Build & push BACKEND image
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-backend:latest ^
  --file src/Dockerfile ^
  src/

# Build & push FRONTEND image
# IMPORTANT: Set REACT_APP_API_BASE_URL to your backend URL.
# You need to deploy the backend FIRST to get its FQDN, then come back here.
# For now, you can use a placeholder or deploy backend, get URL, then rebuild frontend.

az acr build ^
  --registry %ACR_NAME% ^
  --image connext-frontend:latest ^
  --build-arg REACT_APP_API_BASE_URL=https://connext-backend.yellowmoss-xxxxxx.%LOCATION%.azurecontainerapps.io ^
  --file connextproj/Dockerfile ^
  connextproj/
PHASE 4 – Deploy Backend Container App
First, gather all the values from Phase 2:

Variable	Where to get it
DB_PASSWORD	You set it above
POSTGRES_SERVER	You set it above (e.g., connext-db)
JWT_SECRET_KEY	Generated in Phase 1 (secrets.token_hex(64))
SECRET_KEY	Generated in Phase 1 (secrets.token_hex(64))
REDIS_KEY	az redis list-keys output from Phase 2
STORAGE_CONN_STR	az storage account show-connection-string from Phase 2
SENTRY_DSN	From app.sentry.io (optional – skip if not using Sentry)

# Set these as local variables before running the deploy command
SET JWT_SECRET_KEY=<your-128-char-random-string>
SET SECRET_KEY=<your-other-128-char-random-string>
SET REDIS_KEY=<redis-primary-key>
SET STORAGE_CONN_STR=<azure-storage-connection-string>
SET DB_URL_WITH_PWD=postgresql://connext_admin:%DB_PASSWORD%@%POSTGRES_SERVER%.postgres.database.azure.com:5432/connextdb

# Deploy backend to Azure Container Apps
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
    DATABASE_URL="%DB_URL_WITH_PWD%" ^
    JWT_SECRET_KEY="%JWT_SECRET_KEY%" ^
    SECRET_KEY="%SECRET_KEY%" ^
    CORS_ORIGINS="https://connext-frontend.yellowmoss-xxxxxx.%LOCATION%.azurecontainerapps.io" ^
    REDIS_URL="rediss://:connext-redis-key-placeholder@connext-redis.redis.cache.windows.net:6380/0" ^
    FLASK_ENV=production ^
    FLASK_DEBUG=0 ^
    LOG_LEVEL=INFO ^
    DB_POOL_SIZE=10 ^
    DB_POOL_RECYCLE=300 ^
    DB_MAX_OVERFLOW=20 ^
    MAX_UPLOAD_SIZE_MB=10 ^
    UPLOAD_PROVIDER=azure_blob ^
    AZURE_STORAGE_CONNECTION_STRING="%STORAGE_CONN_STR%" ^
    AZURE_STORAGE_CONTAINER=connext-uploads ^
    GEOCOPY_USER_AGENT="ConnextApp/1.0 (your.email@example.com)" ^
    RATE_LIMIT_DEFAULT="200 per day, 50 per hour" ^
    SENTRY_DSN="" ^
    SENTRY_TRACES_SAMPLE_RATE=0.1
Important: Replace the placeholder CORS_ORIGINS value with the actual frontend FQDN after you deploy the frontend. You'll need to update the backend env vars after both are deployed.


# Run database migrations on the deployed backend
az containerapp exec ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --command "flask db upgrade"
PHASE 5 – Deploy Frontend Container App
First, get the backend's actual URL:


# Get the backend FQDN (you need this for the frontend's REACT_APP_API_BASE_URL)
az containerapp show ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --query properties.configuration.ingress.fqdn ^
  -o tsv
Now rebuild the frontend image with the real backend URL, then deploy:


# Rebuild frontend with the actual backend URL
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-frontend:latest ^
  --build-arg REACT_APP_API_BASE_URL=https://<ACTUAL-BACKEND-FQDN> ^
  --file connextproj/Dockerfile ^
  connextproj/

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

# Update the backend's CORS_ORIGINS with the actual frontend URL
# First, get the frontend FQDN:
az containerapp show ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-frontend ^
  --query properties.configuration.ingress.fqdn ^
  -o tsv

# Then update backend env vars:
az containerapp update ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --set-env-vars CORS_ORIGINS="https://<ACTUAL-FRONTEND-FQDN>"
PHASE 6 – Verify Everything

# Check backend health
curl https://<backend-fqdn>/health
# Expected: {"status":"healthy","timestamp":"...","version":"1.0.0"}

curl https://<backend-fqdn>/ready
# Expected: {"status":"ready","database":"connected","timestamp":"..."}

# Open the frontend in browser
start https://<frontend-fqdn>

# View logs if something isn't working
az containerapp logs show --resource-group %RESOURCE_GROUP% --name connext-backend --follow
Quick-Reference: All Azure Resources Created
Resource	Name	Purpose
Resource Group	connext-rg	Contains everything
Container Registry	connextregistry	Docker image storage
PostgreSQL	connext-db	Primary database
Redis	connext-redis	Rate limiting & caching
Storage Account	connextstorage	User profile images
Container App Env	connext-env	Hosting environment
Container App	connext-backend	Flask API (port 5000)
Container App	connext-frontend	React SPA (port 80)
⚠️ Critical Notes Before Uploading
Backend vs Frontend deploy order: You must deploy the backend first, get its FQDN, rebuild the frontend with that URL, then deploy the frontend. The frontend REACT_APP_API_BASE_URL is baked into the JS bundle at build time.

CORS deadlock: Both containers need to know each other's URLs. Deploy backend first (with a placeholder CORS value), deploy frontend, then update backend's CORS_ORIGINS with the real frontend URL.

PostgreSQL firewall: The --public-access 0.0.0.0 flag allows Azure services to connect. For tighter security, restrict to only your Container App environment's outbound IPs after initial setup.

Redis uses TLS 6380: Azure Cache for Redis requires SSL on port 6380. Your REDIS_URL must use rediss:// and port 6380. However, your current redis==5.0.1 and flask-limiter may need ?ssl_cert_reqs=CERT_NONE appended to the URL. You may also need to install redis[hiredis] for SSL support.

Blob Storage uploads: The azure_storage_blob package is already in requirements.txt. You just need to set UPLOAD_PROVIDER=azure_blob in env vars.

WebSocket support: The --transport auto flag on both Container Apps is critical. Without it, SocketIO connections will fail.

Gunicorn single worker: The Dockerfile uses --workers 1 because Eventlet + multiple workers can cause issues with SocketIO sticky sessions. Scale via replicas, not workers.