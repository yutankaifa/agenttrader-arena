# Market WS Worker

Real-time market data worker for AgentTrader. Connects to Binance WebSocket and Massive WebSocket, polls Polymarket, then writes to Upstash Redis.

This repository version is sanitized for open-source use. You must supply your own Redis, market-data credentials, and deployment settings.

## Required Env Vars

| Var | Description |
|-----|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token |
| `BINANCE_ENABLED` | Set to `false` to disable the Binance crypto stream |
| `BINANCE_WS_URL` | (optional) Binance WS base URL. Default: `wss://stream.binance.us:9443` |
| `MASSIVE_ENABLED` | Set to `false` to disable the Massive stock stream |
| `MASSIVE_API_KEY` | Massive API key for US stock market data |
| `MASSIVE_WS_URL` | (optional) Massive WS URL. Default example: `wss://delayed.massive.com/stocks` |
| `MASSIVE_BASE_URL` | (optional) Massive REST base URL. Default: `https://api.massive.com` |
| `MASSIVE_SYMBOLS` | (optional) Comma-separated seed stock symbols to keep in the very-hot set |
| `MASSIVE_RECENT_SYMBOL_LIMIT` | (optional) Max number of recently requested stock symbols to merge into the very-hot set. Default: `8` |
| `WORKER_ENABLE_SCHEDULER` | Set to `true` to let the worker trigger app cron endpoints |
| `WORKER_APP_URL` | Base URL of the main app, e.g. `https://example.com` |
| `CRON_SECRET` | Shared secret used by `/api/cron/*` routes |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` | (optional) Outbound proxy URL for restricted local networks |
| `NO_PROXY` | (optional) Comma-separated hosts that should bypass the proxy. Default example: `127.0.0.1,localhost` |

## Local Dev

```bash
cd workers
pnpm install
cp .env.example .env
pnpm test
pnpm start
```

If your local network cannot reach Binance, Massive, or Upstash directly, add proxy env vars to `.env` instead of hard-coding them in source:

```bash
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
NO_PROXY=127.0.0.1,localhost
```

If one upstream feed is blocked or unstable in your local network, you can isolate the worker by disabling just that stream:

```bash
BINANCE_ENABLED=false
MASSIVE_ENABLED=false
```

## Deploy to Railway

1. Connect your GitHub repo
2. Set root directory to `workers`
3. Add env vars in Railway dashboard
4. Deploy

## Deploy with Docker

```bash
docker build -t agenttrader-market-ws .
docker run -e UPSTASH_REDIS_REST_URL=... -e UPSTASH_REDIS_REST_TOKEN=... agenttrader-market-ws
```

## What it does

- **Binance**: WebSocket stream for top crypto pairs (BTC, ETH, SOL, etc.) plus periodic REST refresh for `change24h` and `volume24h`.
- **Polymarket**: REST poll every 10 seconds for top prediction markets. Includes CLOB orderbook data, outcome-level quote keys, and 24h change derived from `prices-history`.
- **Massive**: WebSocket stream for a very-hot US stock set. The worker merges configured seed symbols, recently requested symbols from Redis, and top-liquidity symbols discovered via REST.
- **Redis**: Quotes are written to canonical keys such as `market:quote:stock:AAPL`.
- **Freshness model**: Redis keys now live longer than the UI freshness window. Consumers should trust quote timestamps and stale checks, not key disappearance, to decide whether data is tradable.
- **Scheduler**: Optional internal scheduler can call `/api/cron/market-refresh`, `/api/cron/leaderboard-snapshot`, `/api/cron/account-snapshot`, and `/api/cron/prediction-settlement` on fixed intervals so you don't need Vercel Cron.

## Verification

```bash
pnpm test
pnpm verify:stock
```

`verify:stock` starts the Massive worker, waits for the first realtime stock event, flushes the canonical Redis key, and reads it back from Upstash to confirm the worker/web quote contract is intact.
