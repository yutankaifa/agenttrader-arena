/**
 * Binance WebSocket Stream
 *
 * Subscribes to combined bookTicker stream for top crypto symbols.
 * Parses incoming data → MarketQuote format → writes to Redis.
 *
 * Binance Combined Stream URL:
 *   wss://stream.binance.us:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/...
 *
 * bookTicker payload:
 *   { s: "BTCUSDT", b: "65000.00", B: "0.5", a: "65001.00", A: "0.3" }
 */

import WebSocket from 'ws';
import type { RedisClient } from './redis-client';

import {
  quoteKey,
  quoteSymbolListKey,
  WORKER_QUOTE_TTL_SECONDS,
  WORKER_SYMBOL_LIST_TTL_SECONDS,
} from 'agenttrader-types';
import { getWebSocketClientOptions } from './ws-proxy';

// Top symbols to track (USDT pairs)
const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP',
];

const QUOTE_TTL = WORKER_QUOTE_TTL_SECONDS;
const LIST_TTL = WORKER_SYMBOL_LIST_TTL_SECONDS;
const FLUSH_INTERVAL = 5000;
const METRICS_REFRESH_INTERVAL = 60 * 1000;

interface BinanceBookTicker { 
  s: string;  // Symbol (e.g. "BTCUSDT")
  b: string;  // Best bid price
  B: string;  // Best bid qty
  a: string;  // Best ask price
  A: string;  // Best ask qty
}
 
type Binance24hrTicker = {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  bidQty: string;
  askQty: string;
  quoteVolume: string;
  priceChangePercent: string;
  closeTime: number;
};

function getBinanceWsUrl(): string {
  return process.env.BINANCE_WS_URL || 'wss://stream.binance.us:9443';
}

function getBinanceRestBaseUrl(): string {
  return process.env.BINANCE_BASE_URL || 'https://api.binance.us';
}

function getBinanceApiKey(): string {
  return process.env.BINANCE_API_KEY || '';
}

function isBinanceEnabled(): boolean {
  const raw = (process.env.BINANCE_ENABLED || '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

async function binanceFetch(path: string): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = getBinanceApiKey();
  if (apiKey) {
    headers['X-MBX-APIKEY'] = apiKey;
  }

  const response = await fetch(`${getBinanceRestBaseUrl()}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function serializeForComparison(quote: Record<string, unknown>): string {
  const { timestamp: _timestamp, ...rest } = quote;
  return JSON.stringify(rest);
}

export class BinanceStream {
  private ws: WebSocket | null = null;
  private redis: RedisClient;
  private symbols: string[];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private isRunning = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private listRefreshInterval: NodeJS.Timeout | null = null;
  private flushInterval: NodeJS.Timeout | null = null;
  private metricsRefreshInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private latestQuotes = new Map<string, Record<string, unknown>>();
  private lastFlushedPayloads = new Map<string, string>();
  private dirtySymbols = new Set<string>();

  constructor(redis: RedisClient, symbols: string[] = DEFAULT_SYMBOLS) {
    this.redis = redis;
    this.symbols = symbols;
  }

  start(): void {
    if (!isBinanceEnabled()) {
      console.warn('[binance-ws] Disabled via BINANCE_ENABLED=false');
      return;
    }
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.listRefreshInterval) clearInterval(this.listRefreshInterval);
    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.metricsRefreshInterval) clearInterval(this.metricsRefreshInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.isRunning) return;

    // Build combined stream URL
    const streams = this.symbols
      .map(s => `${s.toLowerCase()}usdt@bookTicker`)
      .join('/');
    const url = `${getBinanceWsUrl()}/stream?streams=${streams}`;

    console.log(`[binance-ws] Connecting to ${this.symbols.length} streams...`);

    this.ws = new WebSocket(url, getWebSocketClientOptions(url));

    this.ws.on('open', () => {
      console.log('[binance-ws] Connected');
      this.reconnectAttempts = 0;
      this.startPing();
      this.updateSymbolList();
      void this.refresh24hMetrics();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Combined stream wraps in { stream, data }
        const ticker: BinanceBookTicker = msg.data || msg;
        this.handleTicker(ticker);
      } catch (err) {
        console.error('[binance-ws] Parse error:', err);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[binance-ws] Disconnected: ${code} ${reason.toString()}`);
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[binance-ws] Error:', err.message);
    });
  }

  private handleTicker(ticker: BinanceBookTicker): void {
    if (!ticker.s) return;

    const symbol = ticker.s.replace(/USDT$/, '');
    const bid = parseFloat(ticker.b);
    const ask = parseFloat(ticker.a);

    const quote = {
      symbol,
      market: 'crypto',
      provider: 'binance',
      lastPrice: (bid + ask) / 2,
      bid,
      ask,
      midpoint: (bid + ask) / 2,
      spread: ask - bid,
      bidSize: parseFloat(ticker.B),
      askSize: parseFloat(ticker.A),
      volume24h: null,
      change24h: null,
      timestamp: new Date().toISOString(),
    };

    this.latestQuotes.set(symbol, quote);
    this.dirtySymbols.add(symbol);
  }

  private async updateSymbolList(): Promise<void> {
    try {
      await this.redis.set(
        quoteSymbolListKey('crypto'),
        JSON.stringify(this.symbols),
        { ex: LIST_TTL }
      );
    } catch (err) {
      console.error('[binance-ws] Redis list update error:', err);
    }
  }

  private startPing(): void {
    // Send ping every 3 minutes to keep connection alive
    // Binance closes idle connections after 5 minutes
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 3 * 60 * 1000);

    // Refresh symbol list every 20 seconds so consumers retain watchlists across short worker gaps.
    this.listRefreshInterval = setInterval(() => this.updateSymbolList(), 20 * 1000);

    this.flushInterval = setInterval(() => {
      void this.flushDirtyQuotes();
    }, FLUSH_INTERVAL);

    this.metricsRefreshInterval = setInterval(() => {
      void this.refresh24hMetrics();
    }, METRICS_REFRESH_INTERVAL);
  }

  private async refresh24hMetrics(): Promise<void> {
    try {
      const streamSymbols = this.symbols.map((symbol) => `${symbol.toUpperCase()}USDT`);
      const payload = encodeURIComponent(JSON.stringify(streamSymbols));
      const rows = (await binanceFetch(
        `/api/v3/ticker/24hr?symbols=${payload}`
      )) as Binance24hrTicker[];

      for (const row of rows) {
        const symbol = row.symbol.replace(/USDT$/, '');
        const existing = this.latestQuotes.get(symbol);
        const bid = Number.parseFloat(row.bidPrice);
        const ask = Number.parseFloat(row.askPrice);
        const nextQuote = {
          symbol,
          market: 'crypto',
          provider: 'binance',
          lastPrice: Number.parseFloat(row.lastPrice),
          bid: Number.isFinite(bid) ? bid : existing?.bid ?? null,
          ask: Number.isFinite(ask) ? ask : existing?.ask ?? null,
          midpoint:
            Number.isFinite(bid) && Number.isFinite(ask)
              ? (bid + ask) / 2
              : existing?.midpoint ?? Number.parseFloat(row.lastPrice),
          spread:
            Number.isFinite(bid) && Number.isFinite(ask)
              ? ask - bid
              : existing?.spread ?? null,
          bidSize: Number.parseFloat(row.bidQty),
          askSize: Number.parseFloat(row.askQty),
          volume24h: Number.parseFloat(row.quoteVolume),
          change24h: Number.parseFloat(row.priceChangePercent),
          timestamp: new Date(row.closeTime).toISOString(),
        };

        this.latestQuotes.set(symbol, nextQuote);
        this.dirtySymbols.add(symbol);
      }
    } catch (err) {
      console.error('[binance-ws] 24hr metrics refresh error:', err);
    }
  }

  private async flushDirtyQuotes(): Promise<void> {
    if (!this.dirtySymbols.size) return;

    const symbols = Array.from(this.dirtySymbols);
    this.dirtySymbols.clear();

    try {
      const pipeline = this.redis.pipeline();
      let writes = 0;
      for (const symbol of symbols) {
        const quote = this.latestQuotes.get(symbol);
        if (!quote) continue;
        const serialized = JSON.stringify(quote);
        const comparable = serializeForComparison(quote);
        if (this.lastFlushedPayloads.get(symbol) === comparable) {
          continue;
        }
        pipeline.set(
          quoteKey({
            symbol,
            market: 'crypto',
          }),
          serialized,
          {
            ex: QUOTE_TTL,
          }
        );
        this.lastFlushedPayloads.set(symbol, comparable);
        writes += 1;
      }
      if (writes === 0) {
        return;
      }
      await pipeline.exec();
    } catch (err) {
      for (const symbol of symbols) {
        this.dirtySymbols.add(symbol);
      }
      console.error('[binance-ws] Redis batch write error:', err);
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[binance-ws] Max reconnect attempts reached, giving up');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 60s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;
    console.log(`[binance-ws] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
