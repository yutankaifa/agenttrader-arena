import type { MarketAdapter, MarketCandleView, MarketQuote } from '@/lib/market-adapter/types';

const BASE_URL = process.env.MASSIVE_BASE_URL || 'https://api.massive.com';
const API_KEY = process.env.MASSIVE_API_KEY || '';

type MassiveFetchOptions = {
  live?: boolean;
  revalidate?: number;
};

type MassiveSnapshotTicker = {
  ticker?: string;
  day?: {
    c?: number;
    h?: number;
    l?: number;
    o?: number;
    v?: number;
  };
  prevDay?: {
    c?: number;
  };
  lastQuote?: {
    P?: number;
    p?: number;
    S?: number;
    s?: number;
    t?: number;
  };
  lastTrade?: {
    p?: number;
    s?: number;
    t?: number;
  };
  updated?: number;
};

function isMassiveConfigured() {
  return Boolean(API_KEY);
}

function withApiKey(path: string) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}apiKey=${encodeURIComponent(API_KEY)}`;
}

function toValidDate(value: unknown, fallback = new Date()) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toValidDate(numeric, fallback);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const absolute = Math.abs(value);
    let normalized = value;
    if (absolute >= 1e17) {
      normalized = value / 1e6;
    } else if (absolute >= 1e14) {
      normalized = value / 1e3;
    } else if (absolute >= 1e9 && absolute < 1e11) {
      normalized = value * 1e3;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  return fallback;
}

async function massiveFetch(path: string, options: MassiveFetchOptions = {}) {
  if (!isMassiveConfigured()) {
    throw new Error('MASSIVE_API_KEY is not configured');
  }

  const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
    headers: { 'Content-Type': 'application/json' },
  };

  if (options.live) {
    fetchOptions.cache = 'no-store';
  } else {
    fetchOptions.next = { revalidate: options.revalidate ?? 15 };
  }

  const response = await fetch(`${BASE_URL}${withApiKey(path)}`, fetchOptions);
  if (!response.ok) {
    throw new Error(`Massive API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function parseSnapshotTicker(snapshot: MassiveSnapshotTicker): MarketQuote | null {
  const symbol = snapshot.ticker?.toUpperCase();
  const lastPrice = snapshot.lastTrade?.p ?? snapshot.day?.c ?? null;

  if (!symbol || lastPrice == null || !Number.isFinite(lastPrice) || lastPrice <= 0) {
    return null;
  }

  const bid = snapshot.lastQuote?.p ?? null;
  const ask = snapshot.lastQuote?.P ?? null;
  const midpoint = bid != null && ask != null ? (bid + ask) / 2 : lastPrice;
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : null;
  const prevClose = snapshot.prevDay?.c ?? null;
  const change24h =
    prevClose && prevClose !== 0 ? ((lastPrice - prevClose) / prevClose) * 100 : null;

  return {
    market: 'stock',
    provider: 'massive',
    symbol,
    lastPrice,
    bid,
    ask,
    midpoint,
    spread,
    bidSize: snapshot.lastQuote?.s ?? null,
    askSize: snapshot.lastQuote?.S ?? null,
    volume24h: snapshot.day?.v ?? null,
    change24h,
    timestamp: toValidDate(
      snapshot.updated ?? snapshot.lastTrade?.t ?? snapshot.lastQuote?.t,
      new Date()
    ).toISOString(),
  };
}

function toTicker(symbol: string) {
  return symbol.toUpperCase().trim();
}

export const massiveAdapter: MarketAdapter = {
  name: 'massive',
  market: 'stock',

  async getQuote(symbol: string): Promise<MarketQuote | null> {
    if (!isMassiveConfigured()) {
      return null;
    }

    try {
      const ticker = toTicker(symbol);
      const data = await massiveFetch(
        `/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`,
        { live: true }
      );
      return parseSnapshotTicker(data?.ticker ?? data?.results ?? null);
    } catch (error) {
      console.error(`[massive] getQuote(${symbol}) error:`, error);
      return null;
    }
  },

  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    if (!isMassiveConfigured()) {
      return [];
    }

    const quotes = await Promise.all(symbols.map((symbol) => this.getQuote(symbol)));
    return quotes.filter((quote): quote is MarketQuote => Boolean(quote));
  },

  async getCandles(
    symbol: string,
    interval: string,
    limit = 100
  ): Promise<MarketCandleView[]> {
    if (!isMassiveConfigured()) {
      return [];
    }

    try {
      const ticker = toTicker(symbol);
      const now = new Date();
      const rangeMap: Record<
        string,
        {
          multiplier: number;
          timespan: string;
          days: number;
          baseAggregateLimit: (requestedBars: number) => number;
        }
      > = {
        '1m': {
          multiplier: 1,
          timespan: 'minute',
          days: 2,
          baseAggregateLimit: (requestedBars) => requestedBars,
        },
        '5m': {
          multiplier: 5,
          timespan: 'minute',
          days: 5,
          baseAggregateLimit: (requestedBars) => requestedBars * 5,
        },
        '15m': {
          multiplier: 15,
          timespan: 'minute',
          days: 10,
          baseAggregateLimit: (requestedBars) => requestedBars * 15,
        },
        '1h': {
          multiplier: 1,
          timespan: 'hour',
          days: 30,
          baseAggregateLimit: (requestedBars) => requestedBars * 60,
        },
        '1d': {
          multiplier: 1,
          timespan: 'day',
          days: 180,
          baseAggregateLimit: (requestedBars) => requestedBars,
        },
      };

      const config = rangeMap[interval] ?? rangeMap['1d'];
      const from = new Date(now.getTime() - config.days * 24 * 60 * 60 * 1000);
      const queryLimit = Math.min(
        Math.max(config.baseAggregateLimit(limit), limit),
        50000
      );

      const data = await massiveFetch(
        `/v2/aggs/ticker/${ticker}/range/${config.multiplier}/${config.timespan}/${from.toISOString().slice(0, 10)}/${now.toISOString().slice(0, 10)}?adjusted=true&sort=desc&limit=${queryLimit}`,
        { live: true }
      );

      const results = Array.isArray(data?.results) ? data.results : [];
      return results
        .slice()
        .reverse()
        .slice(-limit)
        .map(
          (item: Record<string, number>): MarketCandleView => ({
            market: 'stock',
            provider: 'massive',
            symbol: ticker,
            interval,
            openTime: toValidDate(item.t, now).toISOString(),
            closeTime: toValidDate(item.t, now).toISOString(),
            open: item.o,
            high: item.h,
            low: item.l,
            close: item.c,
            volume: item.v ?? null,
          })
        );
    } catch (error) {
      console.error(`[massive] getCandles(${symbol}) error:`, error);
      return [];
    }
  },

  async getTopSymbols(limit = 20): Promise<string[]> {
    if (!isMassiveConfigured()) {
      return ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN'];
    }

    try {
      const data = await massiveFetch(
        `/v2/snapshot/locale/us/markets/stocks/tickers?limit=${Math.max(limit, 20)}`,
        { revalidate: 15 }
      );
      const tickers: MassiveSnapshotTicker[] = data?.tickers ?? data?.results ?? [];

      return tickers
        .sort(
          (left, right) =>
            (right.day?.v ?? 0) * (right.day?.c ?? 0) -
            (left.day?.v ?? 0) * (left.day?.c ?? 0)
        )
        .slice(0, limit)
        .map((item) => item.ticker?.toUpperCase())
        .filter((item): item is string => Boolean(item));
    } catch (error) {
      console.error('[massive] getTopSymbols error:', error);
      return ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN'];
    }
  },
};
