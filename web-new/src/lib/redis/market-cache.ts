import type { MarketType } from '@/db/schema';
import type { MarketQuote } from '@/lib/market-adapter/types';
import { getRedis, isRedisConfigured, pingRedis } from '@/lib/redis/client';

const QUOTE_PREFIX = 'market:quote:';
const LIST_PREFIX = 'market:quotes:';
const RECENT_LIST_PREFIX = 'market:recent-symbols:';

const QUOTE_TTL = 60;
const LIST_TTL = 30;
const RECENT_LIST_TTL = 6 * 60 * 60;
const RECENT_LIST_LIMIT = 100;

type QuoteLookup =
  | string
  | {
      symbol: string;
      market?: MarketType | null;
      outcomeId?: string | null;
    };

function normalizeQuoteKeyPart(value: string) {
  return value.trim().toUpperCase();
}

function normalizeQuoteLookup(input: QuoteLookup) {
  if (typeof input === 'string') {
    return {
      symbol: input.trim(),
      market: null as MarketType | null,
      outcomeId: null as string | null,
    };
  }

  return {
    symbol: input.symbol.trim(),
    market: input.market ?? null,
    outcomeId: input.outcomeId ?? null,
  };
}

function quoteKey(input: QuoteLookup) {
  const normalized = normalizeQuoteLookup(input);
  const marketPart = normalized.market ? `${normalized.market}:` : '';
  const outcomePart =
    normalized.market === 'prediction' && normalized.outcomeId
      ? `:${normalizeQuoteKeyPart(normalized.outcomeId)}`
      : '';
  return `${QUOTE_PREFIX}${marketPart}${normalizeQuoteKeyPart(normalized.symbol)}${outcomePart}`;
}

function quoteAliasKey(quote: MarketQuote) {
  return quoteKey({
    symbol: quote.symbol,
    market: quote.market,
  });
}

function specificQuoteKey(quote: MarketQuote) {
  return quoteKey({
    symbol: quote.symbol,
    market: quote.market,
    outcomeId: quote.outcomeId ?? null,
  });
}

function listKey(marketType: string) {
  return `${LIST_PREFIX}${marketType}`;
}

function recentListKey(marketType: string) {
  return `${RECENT_LIST_PREFIX}${marketType}`;
}

function normalizeSymbolList(values: unknown) {
  if (!Array.isArray(values)) {
    return [] as string[];
  }

  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function mergeUniqueSymbols(...lists: string[][]) {
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

function unwrapRedisValue(raw: unknown) {
  if (Array.isArray(raw) && raw.length === 2) {
    return raw[1];
  }

  if (raw && typeof raw === 'object' && 'result' in raw) {
    return (raw as { result?: unknown }).result;
  }

  return raw;
}

function parseRedisJson(raw: unknown) {
  const unwrapped = unwrapRedisValue(raw);
  if (typeof unwrapped !== 'string') {
    return unwrapped;
  }

  try {
    return JSON.parse(unwrapped);
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNullableFiniteNumber(value: unknown) {
  return value == null ? null : toFiniteNumber(value);
}

function toIsoTimestamp(value: unknown) {
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}

function normalizeQuotePayload(payload: unknown): MarketQuote | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const symbol = typeof data.symbol === 'string' ? data.symbol.trim() : '';
  const market =
    data.market === 'stock' || data.market === 'crypto' || data.market === 'prediction'
      ? data.market
      : null;
  const lastPrice = toFiniteNumber(data.lastPrice);
  const timestamp = toIsoTimestamp(data.timestamp);

  if (!symbol || !market || lastPrice == null || !timestamp) {
    return null;
  }

  return {
    market,
    provider:
      typeof data.provider === 'string' && data.provider.trim()
        ? data.provider
        : 'redis-cache',
    symbol,
    lastPrice,
    bid: toNullableFiniteNumber(data.bid),
    ask: toNullableFiniteNumber(data.ask),
    midpoint: toNullableFiniteNumber(data.midpoint),
    spread: toNullableFiniteNumber(data.spread),
    bidSize: toNullableFiniteNumber(data.bidSize),
    askSize: toNullableFiniteNumber(data.askSize),
    volume24h: toNullableFiniteNumber(data.volume24h),
    change24h: toNullableFiniteNumber(data.change24h),
    timestamp,
    outcomeId: typeof data.outcomeId === 'string' ? data.outcomeId : null,
    outcomeName: typeof data.outcomeName === 'string' ? data.outcomeName : null,
  };
}

export async function setQuote(quote: MarketQuote) {
  const pipeline = getRedis().pipeline();
  pipeline.set(specificQuoteKey(quote), JSON.stringify(quote), {
    ex: QUOTE_TTL,
  });
  if (quote.market === 'prediction' && quote.outcomeId) {
    pipeline.set(quoteAliasKey(quote), JSON.stringify(quote), {
      ex: QUOTE_TTL,
    });
  }
  await pipeline.exec();
}

export async function getQuote(
  symbol: string,
  market?: MarketType,
  outcomeId?: string | null
) {
  const raw = await getRedis().get<string>(
    quoteKey({
      symbol,
      market,
      outcomeId: market === 'prediction' ? outcomeId ?? null : null,
    })
  );
  if (!raw) return null;
  return normalizeQuotePayload(parseRedisJson(raw));
}

export async function setQuotes(quotes: MarketQuote[]) {
  if (!quotes.length) return 0;

  const pipeline = getRedis().pipeline();
  for (const quote of quotes) {
    pipeline.set(specificQuoteKey(quote), JSON.stringify(quote), {
      ex: QUOTE_TTL,
    });
    if (quote.market === 'prediction' && quote.outcomeId) {
      pipeline.set(quoteAliasKey(quote), JSON.stringify(quote), {
        ex: QUOTE_TTL,
      });
    }
  }

  await pipeline.exec();
  return quotes.length;
}

export async function getQuotes(
  symbols: Array<
    | string
    | {
        symbol: string;
        market?: MarketType | null;
        outcomeId?: string | null;
      }
  >
) {
  if (!symbols.length) return [] as MarketQuote[];

  const pipeline = getRedis().pipeline();
  for (const symbol of symbols) {
    pipeline.get(quoteKey(symbol));
  }

  const results = await pipeline.exec();
  const quotes: MarketQuote[] = [];

  for (const raw of results) {
    if (!raw) continue;
    const quote = normalizeQuotePayload(parseRedisJson(raw));
    if (quote) {
      quotes.push(quote);
    }
  }

  return quotes;
}

export async function setSymbolList(marketType: MarketType, symbols: string[]) {
  await getRedis().set(listKey(marketType), JSON.stringify(symbols), {
    ex: LIST_TTL,
  });
}

export async function getSymbolList(marketType: MarketType) {
  const raw = await getRedis().get<string>(listKey(marketType));
  if (!raw) return [] as string[];
  return normalizeSymbolList(parseRedisJson(raw));
}

export async function getRecentSymbolList(marketType: MarketType) {
  const raw = await getRedis().get<string>(recentListKey(marketType));
  if (!raw) return [] as string[];
  return normalizeSymbolList(parseRedisJson(raw));
}

export async function addRecentSymbols(
  marketType: MarketType,
  symbols: string[]
) {
  const nextSymbols = normalizeSymbolList(symbols);
  if (!nextSymbols.length) {
    return [] as string[];
  }

  const existing = await getRecentSymbolList(marketType).catch(() => []);
  const merged = mergeUniqueSymbols(nextSymbols, existing).slice(
    0,
    RECENT_LIST_LIMIT
  );

  await getRedis().set(recentListKey(marketType), JSON.stringify(merged), {
    ex: RECENT_LIST_TTL,
  });

  return merged;
}

export async function getTrackedSymbolList(marketType: MarketType) {
  const [activeSymbols, recentSymbols] = await Promise.all([
    getSymbolList(marketType).catch(() => []),
    getRecentSymbolList(marketType).catch(() => []),
  ]);

  return mergeUniqueSymbols(activeSymbols, recentSymbols);
}

export async function getAllQuotesByMarket(marketType: MarketType) {
  const symbols = await getTrackedSymbolList(marketType);
  if (!symbols.length) return [] as MarketQuote[];
  return getQuotes(symbols.map((symbol) => ({ symbol, market: marketType })));
}

export async function hasFreshData(marketType: MarketType) {
  if (!isRedisConfigured()) return false;

  try {
    const symbols = await getTrackedSymbolList(marketType);
    if (!symbols.length) return false;
    return (await getQuote(symbols[0], marketType)) != null;
  } catch {
    return false;
  }
}

export async function getCacheStatus() {
  if (!isRedisConfigured()) {
    return {
      configured: false,
      connected: false,
      stock: { symbols: 0, sampleAge: null as number | null },
      crypto: { symbols: 0, sampleAge: null as number | null },
      prediction: { symbols: 0, sampleAge: null as number | null },
    };
  }

  try {
    const connected = await pingRedis();

    async function marketStatus(marketType: MarketType) {
      const symbols = await getTrackedSymbolList(marketType);
      let sampleAge: number | null = null;

      if (symbols.length) {
        const quote = await getQuote(symbols[0], marketType);
        if (quote) {
          sampleAge = Math.round(
            (Date.now() - new Date(quote.timestamp).getTime()) / 1000
          );
        }
      }

      return { symbols: symbols.length, sampleAge };
    }

    return {
      configured: true,
      connected,
      stock: await marketStatus('stock'),
      crypto: await marketStatus('crypto'),
      prediction: await marketStatus('prediction'),
    };
  } catch {
    return {
      configured: true,
      connected: false,
      stock: { symbols: 0, sampleAge: null as number | null },
      crypto: { symbols: 0, sampleAge: null as number | null },
      prediction: { symbols: 0, sampleAge: null as number | null },
    };
  }
}
