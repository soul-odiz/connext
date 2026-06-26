# Connext - Production Deployment Guide

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React SPA  │────▶│  Flask API   │────▶│  PostgreSQL  │
│  (nginx:80)  │     │ (Gunicorn    │     │             │
│              │     │  + Eventlet) │     │             │
│  Azure       │     │  :5000       │     │  Azure DB   │
│  Container   │     │  Azure Cont. │     │  or Docker  │
│  App         │     │  App         │     │             │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │    Redis      │
                    │  (rate limit  │
                    │   + caching)  │
                    └──────────────┘
```

## Quick Start (Local Development with PostgreSQL)

```bash
# Start everything (PostgreSQL + Redis + Backend + Frontend)
docker-compose up --build

# Access:
#   Frontend: http://localhost:3000
#   Backend:  http://localhost:5000
#   Health:   http://localhost:5000/health
```

## Deploy to Azure Container Apps

### Prerequisites
- Azure CLI (`az`)
- Docker
- PostgreSQL database (Azure Database for PostgreSQL Flexible Server)
- Redis instance (Azure Cache for Redis - optional, for rate limiting)

### 1. Create Azure Resources

```bash
# Set variables
RESOURCE_GROUP="connext-rg"
LOCATION="germanywestcentral"
BACKEND_APP="connext-backend"
FRONTEND_APP="connext-frontend"
POSTGRES_SERVER="connext-db"
REDIS_NAME="connext-redis"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create PostgreSQL database
az postgres flexible-server create \
  --resource-group $RESOURCE_GROUP \
  --name $POSTGRES_SERVER \
  --admin-user connext_admin \
  --admin-password "YOUR_SECURE_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32

# Create database
az postgres flexible-server db create \
  --resource-group $RESOURCE_GROUP \
  --server-name $POSTGRES_SERVER \
  --database-name connextdb

# Create Container Registry
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name connextregistry \
  --sku Basic \
  --admin-enabled true
```

### 2. Build and Push Docker Images

```bash
# Login to ACR
az acr login --name connextregistry

# Backend
az acr build \
  --registry connextregistry \
  --image connext-backend:latest \
  --file src/Dockerfile \
  src/

# Frontend
az acr build \
  --registry connextregistry \
  --image connext-frontend:latest \
  --build-arg REACT_APP_API_BASE_URL=https://connext-backend.azurecontainerapps.io \
  --file connextproj/Dockerfile \
  connextproj/
```

### 3. Deploy Backend Container App

```bash
# Create environment
az containerapp env create \
  --resource-group $RESOURCE_GROUP \
  --name connext-env \
  --location $LOCATION

# Deploy backend
az containerapp create \
  --resource-group $RESOURCE_GROUP \
  --name $BACKEND_APP \
  --environment connext-env \
  --image connextregistry.azurecr.io/connext-backend:latest \
  --registry-server connextregistry.azurecr.io \
  --target-port 5000 \
  --ingress external \
  --transport auto \
  --min-replicas 1 \
  --max-replicas 3 \
  --env-vars \
    DATABASE_URL="postgresql://connext_admin:YOUR_SECURE_PASSWORD@$POSTGRES_SERVER.postgres.database.azure.com:5432/connextdb" \
    JWT_SECRET_KEY="<generate-a-random-64-char-string>" \
    CORS_ORIGINS="https://$FRONTEND_APP.kindmoss-4634ec14.germanywestcentral.azurecontainerapps.io" \
    FLASK_ENV=production \
    FLASK_DEBUG=0 \
    LOG_LEVEL=INFO \
    DB_POOL_SIZE=10 \
    MAX_UPLOAD_SIZE_MB=10 \
    RATE_LIMIT_DEFAULT="200 per day, 50 per hour" \
    GEOCOPY_USER_AGENT="ConnextApp/1.0 (your.email@example.com)"
```

### 4. Deploy Frontend Container App

```bash
# Get backend URL
BACKEND_URL=$(az containerapp show \
  --resource-group $RESOURCE_GROUP \
  --name $BACKEND_APP \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

# Deploy frontend
az containerapp create \
  --resource-group $RESOURCE_GROUP \
  --name $FRONTEND_APP \
  --environment connext-env \
  --image connextregistry.azurecr.io/connext-frontend:latest \
  --registry-server connextregistry.azurecr.io \
  --target-port 80 \
  --ingress external \
  --transport auto \
  --min-replicas 1 \
  --max-replicas 3
```

### 5. Run Database Migrations

```bash
# Get backend container name
az containerapp exec \
  --resource-group $RESOURCE_GROUP \
  --name $BACKEND_APP \
  --command "flask db upgrade"
```

## Monitoring

- **Health check**: `https://<backend-url>/health`
- **Readiness**: `https://<backend-url>/ready`
- Logs are in JSON format and can be viewed in Azure Container App logs

## Scaling

The app auto-scales between 1-3 replicas. For higher traffic:
- Increase `--max-replicas`
- Add a PostgreSQL connection pooler (pgBouncer)
- Configure Redis for rate limiting
- Use Azure Front Door CDN for static assets

## Security Checklist

- [ ] JWT_SECRET_KEY is a random 64+ char string (use: `openssl rand -hex 32`)
- [ ] Database password is strong
- [ ] CORS_ORIGINS is set to your actual frontend domain
- [ ] HTTPS is enabled (Azure Container Apps does this by default)
- [ ] File upload size limit is set (MAX_UPLOAD_SIZE_MB)
- [ ] Rate limiting is configured
- [ ] DEBUG mode is OFF
- [ ] Database is NOT SQLite in production
- [ ] Redis is configured for rate limiting storage