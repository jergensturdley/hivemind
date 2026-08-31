# Hivemind web — built for Apple's `container` runtime (linux/arm64).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# WARP RSTs container NAT egress; builds fetch through the host proxy when
# app-up.sh passes it (registry, next/font/google). Scoped to build stages.
ARG HTTPS_PROXY
ENV HTTPS_PROXY=${HTTPS_PROXY}
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG HTTPS_PROXY
ENV HTTPS_PROXY=${HTTPS_PROXY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pool is created at import time; a reachable DB is not required during `next build`.
ENV DATABASE_URL=postgresql://postgres:postgres@hivemind-pg:5432/app_db
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
