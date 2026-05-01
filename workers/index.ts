/**
 * Market Data WebSocket Worker — Entry Point
 *
 * Standalone Node.js process that:
 * 1. Connects to Binance WebSocket for real-time crypto quotes
 * 2. Polls Polymarket Gamma API every 5s for prediction market quotes
 * 3. Polls Massive snapshot APIs for US stock quotes
 * 4. Writes all data to Upstash Redis
 *
 * Usage:
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npx tsx index.ts
 *
 * Deploy:
 *   Docker → Railway / Fly.io / any container host
 */

import { Redis } from '@upstash/redis';
import { createServer } from 'node:http';
import { BinanceStream } from './binance-stream';
import { loadEnvFile } from './env';
import { PolymarketPoller } from './polymarket-stream';
import { InternalScheduler } from './scheduler';
import { MassiveStream } from './stock-stream';

// ── Validate env ──

loadEnvFile();

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PORT = Number(process.env.PORT || 8080);

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error('❌ Missing env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
  console.error('   Get them from https://console.upstash.com → your database → REST API');
  process.exit(1);
}

// ── Initialize ──

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const binance = new BinanceStream(redis);
const polymarket = new PolymarketPoller(redis);
const massive = new MassiveStream(redis);
const scheduler = new InternalScheduler();
let isReady = false;

const server = createServer((req, res) => {
  if (req.url === '/readyz') {
    res.writeHead(isReady ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: isReady }));
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'agenttrader-market-ws' }));
});

// ── Start ──

console.log('🚀 AgentTrader Market WS Worker starting...');
console.log(`   Redis: ${REDIS_URL.replace(/^(https?:\/\/)([^:]+)(.*)/, '$1***$3')}`);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`   Health server: http://0.0.0.0:${PORT}`);
});

async function start() {
  // Verify Redis connectivity
  try {
    const pong = await redis.ping();
    console.log(`   Redis ping: ${pong}`);
  } catch (err) {
    console.error('❌ Redis connection failed:', err);
    process.exit(1);
  }

  binance.start();
  polymarket.start();
  await massive.start();
  scheduler.start();
  isReady = true;

  console.log('✅ Worker running. Press Ctrl+C to stop.');
}

// ── Graceful shutdown ──

function shutdown(signal: string) {
  console.log(`\n🛑 ${signal} received, shutting down...`);
  isReady = false;
  server.close();
  binance.stop();
  polymarket.stop();
  massive.stop();
  scheduler.stop();
  console.log('👋 Bye');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
  // Don't exit — let the streams reconnect
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
});

start();
