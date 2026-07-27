# ============ PRODUCTION DOCKERFILE FOR REACT FRONTEND ============
# Multi-stage build:
#   1. Build the React app
#   2. Serve with nginx

# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build-time API URL (set via CI/CD or docker-compose)
ARG REACT_APP_API_BASE_URL
ENV REACT_APP_API_BASE_URL=${REACT_APP_API_BASE_URL:-http://localhost:5000}

# Copy package files and install dependencies
COPY package.json package-lock.json ./
# Use --legacy-peer-deps instead of --force: resolves peer dependency conflicts
# without overriding version constraints (safer than --force)
RUN npm install --legacy-peer-deps

# Copy source code and build
COPY . .
RUN npm run build

# ---- Stage 2: Serve with nginx ----
FROM nginx:alpine

# Copy the built React app from the builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]