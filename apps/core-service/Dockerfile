FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/auth-service/package.json ./apps/auth-service/package.json
COPY apps/core-service/package.json ./apps/core-service/package.json
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node shared ./shared
COPY --chown=node:node apps/core-service/src ./apps/core-service/src

USER node
EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3003/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/core-service/src/server.js"]
