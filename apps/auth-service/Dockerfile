FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/auth-service/package.json ./apps/auth-service/package.json
COPY apps/core-service/package.json ./apps/core-service/package.json
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node shared ./shared
COPY --chown=node:node apps/auth-service/src ./apps/auth-service/src

USER node
EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/auth-service/src/server.js"]
