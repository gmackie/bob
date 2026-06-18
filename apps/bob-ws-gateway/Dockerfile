# Build stage: install deps + bundle with tsup
FROM node:22-slim AS builder

RUN corepack enable pnpm

WORKDIR /build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/ws-gateway/package.json apps/ws-gateway/
COPY packages/db/package.json packages/db/
COPY packages/ws/package.json packages/ws/

# Install all workspace deps (filtered to ws-gateway + its workspace deps)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/db/ packages/db/
COPY packages/ws/ packages/ws/
COPY apps/ws-gateway/ apps/ws-gateway/

# Build: tsup bundles @bob/* packages into dist/index.js
RUN cd apps/ws-gateway && pnpm build

# Runtime stage: minimal image with just the bundle + runtime deps
FROM node:22-slim AS runtime

RUN corepack enable pnpm

WORKDIR /app

# Copy the built bundle and runtime package.json
COPY --from=builder /build/apps/ws-gateway/dist/ ./dist/
COPY --from=builder /build/apps/ws-gateway/package.json ./

# Install production deps only (ws, pg, drizzle-orm are external)
RUN pnpm install --prod --frozen-lockfile 2>/dev/null || npm install --omit=dev

EXPOSE 3002

ENV NODE_ENV=production
ENV GATEWAY_PORT=3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
