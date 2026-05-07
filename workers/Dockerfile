FROM node:20-alpine

WORKDIR /app

# Install a pnpm version that is compatible with Node 20
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source
COPY . .

# Run
CMD ["pnpm", "start"]
