/**
 * Massive Stock WebSocket Stream
 *
 * Uses Massive WebSocket for live US stock trades and quotes, then writes
 * normalized quote state to Upstash Redis.
 *
 * This worker maintains a very-hot stock set only:
 * - optional configured seed symbols
 * - recently requested symbols from Redis
 * - top-liquidity symbols discovered via REST
 *
 * Live updates come from WebSocket. REST is only used to compose the hot set
 * and hydrate initial snapshots.
 */

import { Redis } from '@upstash/redis';
import WebSocket from 'ws';

import {
  WORKER_QUOTE_TTL_SECONDS,
  WORKER_SYMBOL_LIST_TTL_SECONDS,
} from './cache-contract';
import { quoteKey } from './quote-contract';
import { getWebSocketClientOptions } from './ws-proxy';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN'];
const DEFAULT_LIMIT = 20;
const RECENT_SYMBOLS_KEY = 'market:recent-symbols:stock';
const DEFAULT_RECENT_SYMBOL_LIMIT = 8;
const QUOTE_TTL = WORKER_QUOTE_TTL_SECONDS;
const LIST_TTL = WORKER_SYMBOL_LIST_TTL_SECONDS;
const LIST_REFRESH_INTERVAL = 20 * 1000;
const WATCHLIST_REFRESH_INTERVAL = 10 * 60 * 1000;
const FLUSH_INTERVAL = 5000;
const CONNECTION_LIMIT_RETRY_DELAY_MS = 5000;
let hasLoggedLegacyMassiveWsUrl = false;

type MassiveStatusEvent = {
  ev: 'status';
  message?: string;
  status?: string;
};

type MassiveTradeEvent = {
  ev: 'T';
  sym?: string;
  p?: number;
  s?: number;
  t?: number;
};

type MassiveQuoteEvent = {
  ev: 'Q';
  sym?: string;
  bp?: number;
  ap?: number;
  bs?: number;
  as?: number;
  t?: number;
};

type MassiveSnapshotTicker = {
  ticker?: string;
  day?: {
    c?: number;
    v?: number;
  };
  prevDay?: {
    c?: number;
  };
};

type MassiveMessage =
  | MassiveStatusEvent
  | MassiveTradeEvent
  | MassiveQuoteEvent
  | Record<string, unknown>;

type QuoteState = {
  symbol: string;
  market: 'stock';
  provider: 'massive';
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume24h: number | null;
  change24h: number | null;
  prevClose: number | null;
  timestamp: string;
};

function serializeForComparison(quote: QuoteState): string {
  const { timestamp: _timestamp, prevClose: _prevClose, ...rest } = quote;
  return JSON.stringify(rest);
}

function parseEnvSymbols(): string[] | null {
  const raw = process.env.MASSIVE_SYMBOLS?.trim();
  if (!raw) return null;

  const symbols = raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  return symbols.length ? symbols : null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeSymbols(values: string[]): string[] {
  return values
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function mergeUniqueSymbols(...lists: string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const symbol of list) {
      const normalized = symbol.trim().toUpperCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(normalized);
    }
  }

  return merged;
}

function areSymbolSetsEqual(left: string[], right: string[]): boolean {
  const leftSet = new Set(normalizeSymbols(left));
  const rightSet = new Set(normalizeSymbols(right));

  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const symbol of leftSet) {
    if (!rightSet.has(symbol)) {
      return false;
    }
  }

  return true;
}

function diffSymbols(current: string[], next: string[]) {
  const currentSet = new Set(normalizeSymbols(current));
  const nextSet = new Set(normalizeSymbols(next));

  return {
    added: normalizeSymbols(next).filter((symbol) => !currentSet.has(symbol)),
    removed: normalizeSymbols(current).filter((symbol) => !nextSet.has(symbol)),
  };
}

function buildSubscriptionParams(symbols: string[]): string {
  const normalized = normalizeSymbols(symbols);
  if (!normalized.length) {
    return '';
  }

  const quoteParams = normalized.map((symbol) => `Q.${symbol}`);
  const tradeParams = normalized.map((symbol) => `T.${symbol}`);
  return [...quoteParams, ...tradeParams].join(',');
}

function getMassiveWsUrl(): string {
  const configured = process.env.MASSIVE_WS_URL || 'wss://delayed.massive.com/stocks';
  if (
    configured === 'wss://socket.massive.com/stocks' ||
    configured === 'wss://socket.polygon.io/stocks'
  ) {
    if (!hasLoggedLegacyMassiveWsUrl) {
      hasLoggedLegacyMassiveWsUrl = true;
      console.warn(
        `[massive-ws] Legacy MASSIVE_WS_URL "${configured}" detected; using delayed feed host instead`
      );
    }
    return 'wss://delayed.massive.com/stocks';
  }

  return configured;
}

function getMassiveBaseUrl(): string {
  return process.env.MASSIVE_BASE_URL || 'https://api.massive.com';
}

function getMassiveApiKey(): string {
  return process.env.MASSIVE_API_KEY || '';
}

function isMassiveEnabled(): boolean {
  const raw = (process.env.MASSIVE_ENABLED || '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function withApiKey(path: string): string {
  const apiKey = getMassiveApiKey();
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}apiKey=${encodeURIComponent(apiKey)}`;
}

async function massiveFetch(path: string): Promise<any> {
  const res = await fetch(`${getMassiveBaseUrl()}${withApiKey(path)}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Massive API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export class MassiveStream {
  private ws: WebSocket | null = null;
  private redis: Redis;
  private symbols: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private isRunning = false;
  private isConnecting = false;
  private listRefreshInterval: NodeJS.Timeout | null = null;
  private watchlistRefreshInterval: NodeJS.Timeout | null = null;
  private flushInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionLimitRetryUntil = 0;
  private quoteState = new Map<string, QuoteState>();
  private lastFlushedPayloads = new Map<string, string>();
  private dirtySymbols = new Set<string>();
  private fixedSymbols: string[] | null;
  private limit: number;
  private recentSymbolLimit: number;

  constructor(
    redis: Redis,
    limit = DEFAULT_LIMIT,
    symbols: string[] | null = parseEnvSymbols()
  ) {
    this.redis = redis;
    this.limit = limit;
    this.fixedSymbols = symbols;
    this.recentSymbolLimit = parsePositiveInt(
      process.env.MASSIVE_RECENT_SYMBOL_LIMIT,
      DEFAULT_RECENT_SYMBOL_LIMIT
    );
  }

  async start(): Promise<void> {
    if (!isMassiveEnabled()) {
      console.warn('[massive-ws] Disabled via MASSIVE_ENABLED=false');
      return;
    }
    if (!getMassiveApiKey()) {
      console.warn('[massive-ws] MASSIVE_API_KEY missing, stock stream disabled');
      return;
    }

    if (this.isRunning) return;
    this.isRunning = true;
    await this.refreshWatchlist();
    this.connect();
  }

  stop(): void {
    this.isRunning = false;
    this.isConnecting = false;
    if (this.listRefreshInterval) clearInterval(this.listRefreshInterval);
    if (this.watchlistRefreshInterval) clearInterval(this.watchlistRefreshInterval);
    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.isRunning) return;
    if (this.isConnecting) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      return;
    }
    if (!this.symbols.length) {
      console.warn('[massive-ws] No symbols configured, using defaults');
      this.symbols = DEFAULT_SYMBOLS;
    }

    console.log(`[massive-ws] Connecting to ${this.symbols.length} stock streams...`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    const socketUrl = getMassiveWsUrl();
    const socket = new WebSocket(socketUrl, getWebSocketClientOptions(socketUrl));
    this.ws = socket;

    socket.on('open', () => {
      if (this.ws !== socket) {
        socket.close();
        return;
      }
      console.log('[massive-ws] Connected');
      this.isConnecting = false;
      socket.send(JSON.stringify({ action: 'auth', params: getMassiveApiKey() }));
      this.sendSubscriptionAction('subscribe', this.symbols, socket);
      this.startIntervals();
      void this.updateSymbolList();
    });

    socket.on('message', (data: WebSocket.Data) => {
      try {
        const messages = JSON.parse(data.toString()) as MassiveMessage[];
        for (const message of messages) {
          this.handleMessage(message);
        }
      } catch (err) {
        console.error('[massive-ws] Parse error:', err);
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      if (this.ws === socket) {
        this.ws = null;
      }
      this.isConnecting = false;
      console.log(`[massive-ws] Disconnected: ${code} ${reason.toString()}`);
      this.scheduleReconnect();
    });

    socket.on('error', (err: Error) => {
      if (this.ws === socket && socket.readyState === WebSocket.CLOSED) {
        this.ws = null;
      }
      this.isConnecting = false;
      console.error('[massive-ws] Error:', err.message);
    });
  }

  private handleMessage(message: MassiveMessage): void {
    if (!('ev' in message)) {
      return;
    }

    if (message.ev === 'status') {
      const statusText = `${message.message ?? message.status ?? 'ok'}`;
      console.log(`[massive-ws] Status: ${statusText}`);
      const normalizedStatus = statusText.toLowerCase();
      if (normalizedStatus.includes('maximum number of websocket connections exceeded')) {
        this.connectionLimitRetryUntil = Date.now() + CONNECTION_LIMIT_RETRY_DELAY_MS;
      }
      if (
        normalizedStatus === 'authenticated' ||
        normalizedStatus.includes('authenticated')
      ) {
        this.reconnectAttempts = 0;
        this.connectionLimitRetryUntil = 0;
      }
      return;
    }

    if (message.ev === 'Q') {
      void this.handleQuote(message as MassiveQuoteEvent);
      return;
    }

    if (message.ev === 'T') {
      void this.handleTrade(message as MassiveTradeEvent);
    }
  }

  private async handleQuote(message: MassiveQuoteEvent): Promise<void> {
    const symbol = message.sym?.toUpperCase();
    if (!symbol) return;

    const current = this.getOrCreateState(symbol);
    current.bid = message.bp ?? current.bid;
    current.ask = message.ap ?? current.ask;
    current.bidSize = message.bs ?? current.bidSize;
    current.askSize = message.as ?? current.askSize;
    current.midpoint =
      current.bid !== null && current.ask !== null
        ? (current.bid + current.ask) / 2
        : current.lastPrice;
    current.spread =
      current.bid !== null && current.ask !== null
        ? Math.max(0, current.ask - current.bid)
        : null;
    current.timestamp = new Date(message.t ?? Date.now()).toISOString();

    if (current.lastPrice === null && current.midpoint !== null) {
      current.lastPrice = current.midpoint;
    }

    this.markDirty(symbol);
  }

  private async handleTrade(message: MassiveTradeEvent): Promise<void> {
    const symbol = message.sym?.toUpperCase();
    if (!symbol || message.p === undefined) return;

    const current = this.getOrCreateState(symbol);
    current.lastPrice = message.p;
    current.timestamp = new Date(message.t ?? Date.now()).toISOString();

    if (current.prevClose && current.prevClose !== 0) {
      current.change24h =
        ((current.lastPrice - current.prevClose) / current.prevClose) * 100;
    }

    if (current.bid !== null && current.ask !== null) {
      current.midpoint = (current.bid + current.ask) / 2;
      current.spread = Math.max(0, current.ask - current.bid);
    } else {
      current.midpoint = current.lastPrice;
    }

    this.markDirty(symbol);
  }

  private getOrCreateState(symbol: string): QuoteState {
    const existing = this.quoteState.get(symbol);
    if (existing) return existing;

    const created: QuoteState = {
      symbol,
      market: 'stock',
      provider: 'massive',
      lastPrice: null,
      bid: null,
      ask: null,
      midpoint: null,
      spread: null,
      bidSize: null,
      askSize: null,
      volume24h: null,
      change24h: null,
      prevClose: null,
      timestamp: new Date().toISOString(),
    };
    this.quoteState.set(symbol, created);
    return created;
  }

  private markDirty(symbol: string): void {
    this.dirtySymbols.add(symbol);
  }

  private async updateSymbolList(): Promise<void> {
    try {
      await this.redis.set('market:quotes:stock', JSON.stringify(this.symbols), {
        ex: LIST_TTL,
      });
    } catch (err) {
      console.error('[massive-ws] Redis list update error:', err);
    }
  }

  private async writeHydratedQuotes(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      const quote = this.quoteState.get(symbol);
      if (!quote || quote.lastPrice === null) continue;
      this.markDirty(symbol);
    }
    await this.flushDirtyQuotes();
  }

  private startIntervals(): void {
    if (!this.listRefreshInterval) {
      this.listRefreshInterval = setInterval(
        () => void this.updateSymbolList(),
        LIST_REFRESH_INTERVAL
      );
    }

    if (!this.watchlistRefreshInterval) {
      this.watchlistRefreshInterval = setInterval(
        () => void this.refreshWatchlist(true),
        WATCHLIST_REFRESH_INTERVAL
      );
    }

    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => {
        void this.flushDirtyQuotes();
      }, FLUSH_INTERVAL);
    }
  }

  private async refreshWatchlist(resubscribe = false): Promise<void> {
    try {
      const nextSymbols = await this.buildHotWatchlist();

      if (!nextSymbols.length) {
        this.symbols = DEFAULT_SYMBOLS;
        return;
      }

      const previousSymbols = this.symbols;
      const { added, removed } = diffSymbols(previousSymbols, nextSymbols);
      const changed = !areSymbolSetsEqual(previousSymbols, nextSymbols);

      this.symbols = nextSymbols;
      await this.writeHydratedQuotes(this.symbols);
      await this.updateSymbolList();

      if (resubscribe && changed && this.ws?.readyState === WebSocket.OPEN) {
        console.log(
          `[massive-ws] Watchlist changed (+${added.length} -${removed.length}), updating subscriptions`
        );
        this.updateActiveSubscriptions(added, removed);
      }
    } catch (err) {
      console.error('[massive-ws] Watchlist refresh failed:', err);
      if (!this.symbols.length) {
        this.symbols = DEFAULT_SYMBOLS;
      }
    }
  }

  private async buildHotWatchlist(): Promise<string[]> {
    const [seedSymbols, recentSymbols, topSymbols] = await Promise.all([
      this.fixedSymbols?.length
        ? this.fetchConfiguredStocks(this.fixedSymbols)
        : Promise.resolve([]),
      this.fetchRecentSymbols(),
      this.fetchTopStocks(Math.max(this.limit, DEFAULT_LIMIT)),
    ]);

    const merged = mergeUniqueSymbols(seedSymbols, recentSymbols, topSymbols);
    return merged.slice(0, this.limit);
  }

  private async fetchRecentSymbols(): Promise<string[]> {
    try {
      const raw = await this.redis.get<string>(RECENT_SYMBOLS_KEY);
      if (!raw) return [];

      const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(payload)) return [];

      return normalizeSymbols(
        payload.filter((value): value is string => typeof value === 'string')
      ).slice(0, this.recentSymbolLimit);
    } catch (err) {
      console.warn('[massive-ws] Failed to read recent stock symbols:', err);
      return [];
    }
  }

  private async fetchTopStocks(limit: number): Promise<string[]> {
    const data = await massiveFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?limit=${Math.max(limit, DEFAULT_LIMIT)}`
    );
    const snapshots: MassiveSnapshotTicker[] = data?.tickers ?? data?.results ?? [];

    const topSnapshots = snapshots
      .sort(
        (a, b) =>
          (b.day?.v ?? 0) * (b.day?.c ?? 0) - (a.day?.v ?? 0) * (a.day?.c ?? 0)
      )
      .slice(0, limit);

    for (const snapshot of topSnapshots) {
      this.hydrateStateFromSnapshot(snapshot);
    }

    return topSnapshots
      .map((item) => item.ticker?.toUpperCase())
      .filter((item): item is string => Boolean(item));
  }

  private async fetchConfiguredStocks(symbols: string[]): Promise<string[]> {
    const snapshots = await Promise.all(
      symbols.map(async (symbol) => {
        const data = await massiveFetch(
          `/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`
        );
        return data?.ticker ?? data?.results ?? null;
      })
    );

    for (const snapshot of snapshots) {
      if (snapshot) {
        this.hydrateStateFromSnapshot(snapshot as MassiveSnapshotTicker);
      }
    }

    return normalizeSymbols(symbols);
  }

  private hydrateStateFromSnapshot(snapshot: MassiveSnapshotTicker): void {
    const symbol = snapshot.ticker?.toUpperCase();
    const lastPrice = snapshot.day?.c ?? null;
    if (!symbol || lastPrice === null) return;

    const current = this.getOrCreateState(symbol);
    current.lastPrice = lastPrice;
    current.volume24h = snapshot.day?.v ?? current.volume24h;
    const prevClose = snapshot.prevDay?.c ?? null;
    current.prevClose = prevClose ?? current.prevClose;
    current.change24h =
      prevClose && prevClose !== 0
        ? ((lastPrice - prevClose) / prevClose) * 100
        : current.change24h;
  }

  private sendSubscriptionAction(
    action: 'subscribe' | 'unsubscribe',
    symbols: string[],
    socket = this.ws
  ): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const params = buildSubscriptionParams(symbols);
    if (!params) {
      return;
    }

    socket.send(JSON.stringify({ action, params }));
  }

  private updateActiveSubscriptions(addedSymbols: string[], removedSymbols: string[]): void {
    try {
      this.sendSubscriptionAction('unsubscribe', removedSymbols);
      this.sendSubscriptionAction('subscribe', addedSymbols);
    } catch (err) {
      console.error('[massive-ws] Subscription update failed, falling back to reconnect:', err);
      this.ws?.close();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[massive-ws] Max reconnect attempts reached, giving up');
      return;
    }

    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    const connectionLimitDelay = Math.max(0, this.connectionLimitRetryUntil - Date.now());
    const delay = Math.max(baseDelay, connectionLimitDelay);
    this.reconnectAttempts++;
    console.log(
      `[massive-ws] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.refreshWatchlist();
      this.connect();
    }, delay);
  }

  private async flushDirtyQuotes(): Promise<void> {
    if (!this.dirtySymbols.size) return;

    const symbols = Array.from(this.dirtySymbols);
    this.dirtySymbols.clear();

    try {
      const pipeline = this.redis.pipeline();
      let writes = 0;

      for (const symbol of symbols) {
        const quote = this.quoteState.get(symbol);
        if (!quote || quote.lastPrice === null) continue;
        const { prevClose: _prevClose, ...persistedQuote } = quote;
        const serialized = JSON.stringify(persistedQuote);
        const comparable = serializeForComparison(quote);
        if (this.lastFlushedPayloads.get(symbol) === comparable) {
          continue;
        }
        pipeline.set(
          quoteKey({
            symbol: quote.symbol,
            market: quote.market,
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
      console.error('[massive-ws] Redis batch write error:', err);
    }
  }
}
