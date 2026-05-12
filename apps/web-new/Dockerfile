FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat && \
    corepack enable && \
    corepack prepare pnpm@10.29.3 --activate

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /repo

FROM base AS builder

ARG NEXT_PUBLIC_APP_URL
ARG AUTH_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV AUTH_URL=$AUTH_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web-new/package.json ./apps/web-new/package.json
COPY apps/workers/package.json ./apps/workers/package.json
COPY packages/agenttrader-types/package.json ./packages/agenttrader-types/package.json
RUN pnpm --filter web-new... fetch --frozen-lockfile

COPY apps/web-new ./apps/web-new
COPY packages/agenttrader-types ./packages/agenttrader-types

RUN pnpm --filter web-new... install --offline --frozen-lockfile
RUN pnpm --filter web-new build

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /repo/apps/web-new/.next/standalone ./
COPY --from=builder /repo/apps/web-new/public ./apps/web-new/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web-new/.next/static ./apps/web-new/.next/static

USER nextjs

EXPOSE 8080

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

CMD ["node", "apps/web-new/server.js"]
