@echo off
REM ============================================================
REM Connext Deployment Script — Using YOUR actual Azure resources
REM ============================================================
REM Resource Group: portfolio-rg
REM Region:          israelcentral
REM PostgreSQL:      productionconnext.postgres.database.azure.com
REM Admin:           connextAdmin
REM DB Name:         connextdb (create this in the portal first!)
REM ============================================================
REM
REM PREREQUISITES (create these in the Azure portal "Create a resource" page):
REM   [ ] Container Registry  → name: connextregistry     SKU: Basic
REM   [ ] Redis Cache         → name: connext-redis        SKU: Basic C0
REM   [ ] Storage Account     → name: portfoliostorage     SKU: Standard LRS
REM   [ ] In Storage Account  → Container: connext-uploads
REM   [ ] Container Apps Env  → name: connext-env           (created when you make your first Container App)
REM   [ ] In PostgreSQL       → Database: connextdb        (Databases → + Add)
REM ============================================================
REM
REM BEFORE RUNNING THIS SCRIPT:
REM   1. Fill in <YOUR_DB_PASSWORD> and generated secrets below
REM   2. Run: python -c "import secrets; print(secrets.token_hex(64))" twice
REM   3. Paste those into JWT_SECRET_KEY and SECRET_KEY below
REM   4. Get Redis primary key: az redis list-keys -g portfolio-rg -n connext-redis --query primaryKey -o tsv
REM   5. Get Storage key: az storage account show-connection-string -g portfolio-rg -n portfoliostorage --query connectionString -o tsv
REM ============================================================

SETLOCAL

REM ---- FILL THESE IN ----
SET DB_PASSWORD=<w$s15qeww>
SET JWT_SECRET_KEY=<128_CHAR_HEX_FROM_SECRETS>
SET SECRET_KEY=<ANOTHER_128_CHAR_HEX_FROM_SECRETS>
SET REDIS_PRIMARY_KEY=<FROM_az_redis_list_keys>
SET STORAGE_CONN_STR=<FROM_az_storage_show_connection_string>

REM ---- FIREBASE AUTH (optional) ----
REM Fill these from Firebase Console to enable Google/Apple/email sign-up.
REM FIREBASE_SERVICE_ACCOUNT_B64 is the base64 of your serviceAccountKey.json.
SET REACT_APP_FIREBASE_API_KEY=<FIREBASE_API_KEY>
SET REACT_APP_FIREBASE_AUTH_DOMAIN=<FIREBASE_AUTH_DOMAIN>
SET REACT_APP_FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>
SET REACT_APP_FIREBASE_APP_ID=<FIREBASE_APP_ID>
SET REACT_APP_FIREBASE_MESSAGING_SENDER_ID=<FIREBASE_MESSAGING_SENDER_ID>
SET REACT_APP_FIREBASE_STORAGE_BUCKET=<FIREBASE_STORAGE_BUCKET>
SET FIREBASE_SERVICE_ACCOUNT_B64=<BASE64_OF_SERVICE_ACCOUNT_JSON>

REM ---- FIXED VALUES (no need to change) ----
SET RESOURCE_GROUP=portfolio-rg
SET LOCATION=israelcentral
SET ACR_NAME=connextregistry
SET POSTGRES_FQDN=productionconnext.postgres.database.azure.com
SET DB_NAME=connextdb
SET DB_USER=connextAdmin
SET REDIS_HOST=connext-redis.redis.cache.windows.net
SET REDIS_PORT=6380
SET STORAGE_ACCOUNT=portfoliostorage
SET ENV_NAME=connext-env

REM ============================================================
REM STEP 1: Login and get secrets
REM ============================================================
echo [*] Logging into Azure...
az login
az acr login --name %ACR_NAME%

echo [*] Building connection strings...
SET DB_URL=postgresql://%DB_USER%:%DB_PASSWORD%@%POSTGRES_FQDN%:5432/%DB_NAME%
SET REDIS_URL=rediss://:%REDIS_PRIMARY_KEY%@%REDIS_HOST%:%REDIS_PORT%/0
echo DB_URL=%DB_URL%
echo REDIS_URL=%REDIS_URL%

REM ============================================================
REM STEP 2: Build & Push BACKEND Docker image
REM ============================================================
echo [*] Building backend Docker image in ACR...
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-backend:latest ^
  --file src/Dockerfile ^
  src/

if %ERRORLEVEL% NEQ 0 (
  echo [!] Backend build failed! Check errors above.
  exit /b 1
)
echo [+] Backend image built and pushed.

REM ============================================================
REM STEP 3: Deploy BACKEND Container App
REM ============================================================
echo [*] Deploying backend Container App...
az containerapp create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --environment %ENV_NAME% ^
  --image %ACR_NAME%.azurecr.io/connext-backend:latest ^
  --registry-server %ACR_NAME%.azurecr.io ^
  --target-port 5000 ^
  --ingress external ^
  --transport auto ^
  --min-replicas 0 ^
  --max-replicas 3 ^
  --cpu 0.25 ^
  --memory 0.5Gi ^
  --env-vars ^
    DATABASE_URL="%DB_URL%" ^
    JWT_SECRET_KEY="%JWT_SECRET_KEY%" ^
    SECRET_KEY="%SECRET_KEY%" ^
    CORS_ORIGINS="http://localhost:3000" ^
    REDIS_URL="%REDIS_URL%" ^
    FLASK_ENV="production" ^
    FLASK_DEBUG="0" ^
    LOG_LEVEL="INFO" ^
    DB_POOL_SIZE="10" ^
    DB_POOL_RECYCLE="300" ^
    DB_MAX_OVERFLOW="20" ^
    MAX_UPLOAD_SIZE_MB="10" ^
    UPLOAD_PROVIDER="azure_blob" ^
    AZURE_STORAGE_CONNECTION_STRING="%STORAGE_CONN_STR%" ^
    AZURE_STORAGE_CONTAINER="connext-uploads" ^
    GEOCOPY_USER_AGENT="ConnextApp/1.0 (your.email@example.com)" ^
    FIREBASE_SERVICE_ACCOUNT_B64="%FIREBASE_SERVICE_ACCOUNT_B64%" ^
    RATE_LIMIT_DEFAULT="200 per day; 50 per hour" ^
    RATE_LIMIT_REGISTER="10 per hour" ^
    RATE_LIMIT_LOGIN="20 per hour" ^
    RATE_LIMIT_UPLOAD="10 per hour" ^
    RATE_LIMIT_MESSAGE="60 per minute" ^
    SOCKETIO_ASYNC_MODE="eventlet" ^
    REQUIRE_SOCKET_AUTH="true" ^
    SENTRY_DSN="" ^
    SENTRY_TRACES_SAMPLE_RATE="0.1"

if %ERRORLEVEL% NEQ 0 (
  echo [!] Backend deployment failed!
  exit /b 1
)
echo [+] Backend deployed.

REM ============================================================
REM STEP 4: Run database migrations
REM ============================================================
echo [*] Running database migrations...
az containerapp exec ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --command "flask db upgrade"

echo [+] Migrations applied.

REM ============================================================
REM STEP 5: Get backend FQDN
REM ============================================================
echo [*] Getting backend URL...
for /f "tokens=*" %%i in ('az containerapp show --resource-group %RESOURCE_GROUP% --name connext-backend --query properties.configuration.ingress.fqdn -o tsv') do set BACKEND_FQDN=%%i

echo [+] Backend FQDN: %BACKEND_FQDN%

REM ============================================================
REM STEP 6: Verify backend health
REM ============================================================
echo [*] Checking backend health...
curl https://%BACKEND_FQDN%/health
curl https://%BACKEND_FQDN%/ready

REM ============================================================
REM STEP 7: Build FRONTEND with real backend URL
REM ============================================================
echo [*] Building frontend with API URL: https://%BACKEND_FQDN%
az acr build ^
  --registry %ACR_NAME% ^
  --image connext-frontend:latest ^
  --build-arg REACT_APP_API_BASE_URL="https://%BACKEND_FQDN%" ^
  --build-arg REACT_APP_FIREBASE_API_KEY="%REACT_APP_FIREBASE_API_KEY%" ^
  --build-arg REACT_APP_FIREBASE_AUTH_DOMAIN="%REACT_APP_FIREBASE_AUTH_DOMAIN%" ^
  --build-arg REACT_APP_FIREBASE_PROJECT_ID="%REACT_APP_FIREBASE_PROJECT_ID%" ^
  --build-arg REACT_APP_FIREBASE_APP_ID="%REACT_APP_FIREBASE_APP_ID%" ^
  --build-arg REACT_APP_FIREBASE_MESSAGING_SENDER_ID="%REACT_APP_FIREBASE_MESSAGING_SENDER_ID%" ^
  --build-arg REACT_APP_FIREBASE_STORAGE_BUCKET="%REACT_APP_FIREBASE_STORAGE_BUCKET%" ^
  --file connextproj/Dockerfile ^
  connextproj/

if %ERRORLEVEL% NEQ 0 (
  echo [!] Frontend build failed!
  exit /b 1
)
echo [+] Frontend image built and pushed.

REM ============================================================
REM STEP 8: Deploy FRONTEND Container App
REM ============================================================
echo [*] Deploying frontend...
az containerapp create ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-frontend ^
  --environment %ENV_NAME% ^
  --image %ACR_NAME%.azurecr.io/connext-frontend:latest ^
  --registry-server %ACR_NAME%.azurecr.io ^
  --target-port 80 ^
  --ingress external ^
  --transport auto ^
  --min-replicas 0 ^
  --max-replicas 3 ^
  --cpu 0.25 ^
  --memory 0.5Gi

if %ERRORLEVEL% NEQ 0 (
  echo [!] Frontend deployment failed!
  exit /b 1
)
echo [+] Frontend deployed.

REM ============================================================
REM STEP 9: Get frontend FQDN
REM ============================================================
echo [*] Getting frontend URL...
for /f "tokens=*" %%i in ('az containerapp show --resource-group %RESOURCE_GROUP% --name connext-frontend --query properties.configuration.ingress.fqdn -o tsv') do set FRONTEND_FQDN=%%i

echo [+] Frontend FQDN: %FRONTEND_FQDN%

REM ============================================================
REM STEP 10: Update CORS with real frontend URL
REM ============================================================
echo [*] Updating CORS to allow: https://%FRONTEND_FQDN%
az containerapp update ^
  --resource-group %RESOURCE_GROUP% ^
  --name connext-backend ^
  --set-env-vars CORS_ORIGINS="https://%FRONTEND_FQDN%,http://localhost:3000"

echo [+] CORS updated.

REM ============================================================
REM DONE
REM ============================================================
echo.
echo ================================================================
echo   DEPLOYMENT COMPLETE!
echo   Frontend: https://%FRONTEND_FQDN%
echo   Backend:  https://%BACKEND_FQDN%/health
echo   Resource Group: %RESOURCE_GROUP%
echo   PostgreSQL: %POSTGRES_FQDN%
echo ================================================================
echo.
echo   Monitoring commands:
echo     Logs:   az containerapp logs show -g %RESOURCE_GROUP% -n connext-backend --follow
echo     Status: az containerapp show -g %RESOURCE_GROUP% -n connext-backend
echo.
echo   To save money when idle, min-replicas is set to 0 (scales to zero).
echo   First visitor after idle period will experience ~5-10s cold start.
echo ================================================================