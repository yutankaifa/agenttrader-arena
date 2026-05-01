FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat && corepack enable

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

FROM base AS builder

ARG NEXT_PUBLIC_APP_URL
ARG AUTH_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV AUTH_URL=$AUTH_URL

COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch --frozen-lockfile

COPY . .

RUN pnpm install --offline --frozen-lockfile
RUN pnpm build

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

CMD ["node", "server.js"]
