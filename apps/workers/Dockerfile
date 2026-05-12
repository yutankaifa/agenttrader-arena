FROM node:20-alpine

WORKDIR /repo

# Install the pnpm version used by the root workspace lockfile
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Copy workspace package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web-new/package.json ./apps/web-new/package.json
COPY apps/workers/package.json ./apps/workers/package.json
COPY packages/agenttrader-types/package.json ./packages/agenttrader-types/package.json

RUN pnpm --filter agenttrader-market-ws... fetch --frozen-lockfile

# Copy source
COPY apps/workers ./apps/workers
COPY packages/agenttrader-types ./packages/agenttrader-types

# Install dependencies
RUN pnpm --filter agenttrader-market-ws... install --offline --frozen-lockfile

# Run
CMD ["pnpm", "--filter", "agenttrader-market-ws", "start"]
