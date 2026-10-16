# Build from the backend repository root:
# docker-compose -f compose.yml -f compose.apps.yml build gateway
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Copy manifests first: npm ci uses the committed lockfile.
COPY package.json package-lock.json ./
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/auth-service/package.json ./apps/auth-service/package.json
COPY apps/core-service/package.json ./apps/core-service/package.json
RUN npm ci --omit=dev --no-audit --no-fund

# Keep the existing relative JavaScript imports working.
COPY --chown=node:node shared ./shared
COPY --chown=node:node apps/api-gateway/src ./apps/api-gateway/src
COPY --chown=node:node scripts/smoke-internal.js ./scripts/smoke-internal.js

USER node
EXPOSE 3001

# This checks process liveness, NOT database readiness or route forwarding.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api-gateway/src/server.js"]
