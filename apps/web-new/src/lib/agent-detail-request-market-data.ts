import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import type { MarketType } from 'agenttrader-types';
import {
  binanceAdapter,
  getCandles,
  getLatestQuote,
  massiveAdapter,
  type MarketCandleView,
  type MarketQuote,
  polymarketAdapter,
} from '@/lib/market-adapter';
import { getQuote as getRedisQuote, isRedisConfigured } from '@/lib/redis';
import {
  normalizeOutcomeObjectKey,
  toIsoValue,
} from '@/lib/agent-runtime-service-common';
import {
  type NormalizedDetailObject,
  normalizeLookupKey,
  type PredictionMarketDetailsView,
} from '@/lib/agent-detail-request-objects';
import { type PredictionEventResolution } from '@/lib/agent-detail-request-prediction';

export type DetailQuoteResult = {
  quote: MarketQuote | null;
  source: string;
  error?: string;
};

type DetailCandleResult = {
  candles: MarketCandleView[];
  source: string;
  error?: string;
};

const DETAIL_QUOTE_STALE_MS: Record<MarketType, number> = {
  stock: 120_000,
  crypto: 60_000,
  prediction: 30_000,
};

function buildPredictionInstrumentId(symbol: string, outcomeId?: string | null) {
  return outcomeId ? `${symbol}::${outcomeId}` : symbol;
}

function getLiveQuoteProviderError(market: MarketType) {
  if (market === 'stock' && !process.env.MASSIVE_API_KEY) {
    return 'provider_not_configured:MASSIVE_API_KEY';
  }
  return null;
}

function isStaleDetailQuote(
  market: MarketType,
  quote: Pick<MarketQuote, 'timestamp'> | null | undefined
) {
  if (!quote?.timestamp) {
    return false;
  }

  const parsedTimestamp = Date.parse(quote.timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  return Date.now() - parsedTimestamp > DETAIL_QUOTE_STALE_MS[market];
}

async function fetchLiveDetailQuote(input: {
  market: MarketType;
  symbol: string;
  outcomeId?: string | null;
}) {
  const providerError = getLiveQuoteProviderError(input.market);
  if (providerError) {
    return { quote: null, source: 'unavailable', error: providerError } satisfies DetailQuoteResult;
  }

  if (input.market === 'stock') {
    const quote = await massiveAdapter.getQuote(input.symbol);
    return {
      quote,
      source: quote ? `live:${quote.provider}` : 'unavailable',
      error: quote ? undefined : 'cache_miss_or_provider_unavailable',
    } satisfies DetailQuoteResult;
  }

  if (input.market === 'crypto') {
    const quote = await binanceAdapter.getQuote(input.symbol);
    return {
      quote,
      source: quote ? `live:${quote.provider}` : 'unavailable',
      error: quote ? undefined : 'cache_miss_or_provider_unavailable',
    } satisfies DetailQuoteResult;
  }

  const instrumentId = buildPredictionInstrumentId(input.symbol, input.outcomeId);
  const quote = await polymarketAdapter.getQuote(instrumentId);
  return {
    quote,
    source: quote ? `live:${quote.provider}` : 'unavailable',
    error: quote ? undefined : 'cache_miss_or_provider_unavailable',
  } satisfies DetailQuoteResult;
}

async function maybeEnrichDetailQuoteMetrics(
  quoteResult: DetailQuoteResult,
  input: {
    market: MarketType;
    symbol: string;
    outcomeId?: string | null;
  }
) {
  if (process.env.AGENTTRADER_MARKET_DATA_MODE?.trim().toLowerCase() === 'sim') {
    return quoteResult;
  }

  if (
    !quoteResult.quote ||
    (quoteResult.quote.change24h != null && quoteResult.quote.volume24h != null)
  ) {
    return quoteResult;
  }

  const liveResult = await fetchLiveDetailQuote(input);
  if (!liveResult.quote) {
    return quoteResult;
  }

  return {
    ...quoteResult,
    quote: {
      ...quoteResult.quote,
      change24h: quoteResult.quote.change24h ?? liveResult.quote.change24h,
      volume24h: quoteResult.quote.volume24h ?? liveResult.quote.volume24h,
    },
  } satisfies DetailQuoteResult;
}

async function getDetailQuoteFromDatabase(input: {
  market: MarketType;
  symbol: string;
  outcomeId?: string | null;
  exactOutcomeRequired?: boolean;
}) {
  const sql = getSqlClient();
  const instrumentRows = await sql<
    {
      id: string;
      symbol: string;
      market: string;
    }[]
  >`
    select id, symbol, market
    from market_instruments
    where upper(symbol) = upper(${input.symbol})
      and market = ${input.market}
    limit 1
  `;
  const instrument = instrumentRows[0] ?? null;
  const exactKey =
    input.market === 'prediction' && input.outcomeId
      ? `${input.symbol}::${input.outcomeId}`
      : null;
  const candidateKeys = [
    exactKey,
    input.symbol,
    instrument?.id ?? null,
  ].filter((value, index, items): value is string => Boolean(value) && items.indexOf(value) === index);

  for (const key of candidateKeys) {
    const quoteRows = await sql<
      {
        provider: string;
        last_price: number | null;
        bid: number | null;
        ask: number | null;
        midpoint: number | null;
        spread: number | null;
        bid_size: number | null;
        ask_size: number | null;
        depth_snapshot: string | null;
        quote_ts: string | Date | null;
      }[]
    >`
      select
        provider,
        last_price,
        bid,
        ask,
        midpoint,
        spread,
        bid_size,
        ask_size,
        depth_snapshot,
        quote_ts
      from market_data_snapshots
      where instrument_id = ${key}
      order by quote_ts desc
      limit 1
    `;
    const row = quoteRows[0] ?? null;
    if (!row?.last_price) {
      if (input.exactOutcomeRequired && key === exactKey) {
        return null;
      }
      continue;
    }

    return {
      market: input.market,
      provider: row.provider,
      symbol: input.symbol,
      lastPrice: row.last_price,
      bid: row.bid,
      ask: row.ask,
      midpoint: row.midpoint,
      spread: row.spread,
      bidSize: row.bid_size,
      askSize: row.ask_size,
      depthSnapshot: row.depth_snapshot,
      volume24h: null,
      change24h: null,
      timestamp: toIsoValue(row.quote_ts) ?? new Date().toISOString(),
      outcomeId: input.outcomeId ?? null,
      outcomeName: null,
    } satisfies MarketQuote;
  }

  return null;
}

async function resolveDetailQuote(input: {
  market: MarketType;
  symbol: string;
  outcomeId?: string | null;
  exactOutcomeRequired?: boolean;
}) {
  const normalizedOutcomeId = input.outcomeId ?? null;
  const preferFreshExactPredictionQuote =
    input.market === 'prediction' && input.exactOutcomeRequired === true;
  let staleFallback:
    | (DetailQuoteResult & {
        quote: MarketQuote;
      })
    | null = null;

  if (isRedisConfigured()) {
    try {
      const redisQuote = await getRedisQuote(
        input.symbol,
        input.market,
        input.market === 'prediction' ? normalizedOutcomeId : null
      );
      if (redisQuote) {
        const enriched = await maybeEnrichDetailQuoteMetrics(
          {
            quote: redisQuote,
            source: 'redis',
          },
          input
        );
        if (
          preferFreshExactPredictionQuote &&
          enriched.quote &&
          isStaleDetailQuote(input.market, enriched.quote)
        ) {
          staleFallback = enriched as DetailQuoteResult & { quote: MarketQuote };
        } else {
          return enriched;
        }
      }
    } catch {
      // fall through
    }
  }

  if (isDatabaseConfigured()) {
    const databaseQuote = await getDetailQuoteFromDatabase(input);
    if (databaseQuote) {
      const enriched = await maybeEnrichDetailQuoteMetrics(
        {
          quote: databaseQuote,
          source: 'db',
        },
        input
      );
      if (
        preferFreshExactPredictionQuote &&
        enriched.quote &&
        isStaleDetailQuote(input.market, enriched.quote)
      ) {
        staleFallback ??= enriched as DetailQuoteResult & { quote: MarketQuote };
      } else {
        return enriched;
      }
    }
  }

  const storeQuote =
    input.market === 'prediction' && input.exactOutcomeRequired
      ? getLatestQuote(input.symbol, input.market, normalizedOutcomeId)
      : getLatestQuote(input.symbol, input.market, normalizedOutcomeId) ??
        getLatestQuote(input.symbol, input.market);
  if (storeQuote) {
    const enriched = await maybeEnrichDetailQuoteMetrics(
      {
        quote: storeQuote,
        source: 'db',
      },
      input
    );
    if (
      preferFreshExactPredictionQuote &&
      enriched.quote &&
      isStaleDetailQuote(input.market, enriched.quote)
    ) {
      staleFallback ??= enriched as DetailQuoteResult & { quote: MarketQuote };
    } else {
      return enriched;
    }
  }

  const liveResult = await fetchLiveDetailQuote(input);
  if (liveResult.quote) {
    return liveResult;
  }

  return staleFallback ?? liveResult;
}

async function fetchLiveDetailCandles(input: {
  market: MarketType;
  symbol: string;
  interval: string;
  limit: number;
  outcomeId?: string | null;
}) {
  const providerError = getLiveQuoteProviderError(input.market);
  if (providerError) {
    return {
      candles: [],
      source: 'unavailable',
      error: providerError,
    } satisfies DetailCandleResult;
  }

  if (input.market === 'stock') {
    const candles = await massiveAdapter.getCandles(input.symbol, input.interval, input.limit);
    return {
      candles,
      source: candles.length ? 'live:massive' : 'unavailable',
      error: candles.length ? undefined : 'no_candle_history_or_provider_unavailable',
    } satisfies DetailCandleResult;
  }

  if (input.market === 'crypto') {
    const candles = await binanceAdapter.getCandles(input.symbol, input.interval, input.limit);
    return {
      candles,
      source: candles.length ? 'live:binance' : 'unavailable',
      error: candles.length ? undefined : 'no_candle_history_or_provider_unavailable',
    } satisfies DetailCandleResult;
  }

  const instrumentId = buildPredictionInstrumentId(input.symbol, input.outcomeId);
  const candles = await polymarketAdapter.getCandles(instrumentId, input.interval, input.limit);
  return {
    candles,
    source: candles.length ? 'live:polymarket' : 'unavailable',
    error: candles.length ? undefined : 'no_candle_history_or_provider_unavailable',
  } satisfies DetailCandleResult;
}

async function getDetailCandlesFromDatabase(input: {
  market: MarketType;
  symbol: string;
  interval: string;
  limit: number;
  outcomeId?: string | null;
}) {
  const sql = getSqlClient();
  const instrumentRows = await sql<{ id: string }[]>`
    select id
    from market_instruments
    where upper(symbol) = upper(${input.symbol})
      and market = ${input.market}
    limit 1
  `;
  const instrumentId =
    input.market === 'prediction' && input.outcomeId
      ? `${input.symbol}::${input.outcomeId}`
      : (instrumentRows[0]?.id ?? null);
  if (!instrumentId) {
    return [] as MarketCandleView[];
  }

  const rows = await sql<
    {
      open_time: string | Date | null;
      close_time: string | Date | null;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number | null;
    }[]
  >`
    select
      open_time,
      close_time,
      open,
      high,
      low,
      close,
      volume
    from market_candles
    where instrument_id = ${instrumentId}
      and interval = ${input.interval}
    order by open_time desc
    limit ${input.limit}
  `;

  return rows
    .slice()
    .reverse()
    .map((row) => ({
      market: input.market,
      symbol: input.symbol,
      interval: input.interval,
      openTime: toIsoValue(row.open_time) ?? new Date().toISOString(),
      closeTime:
        toIsoValue(row.close_time) ?? toIsoValue(row.open_time) ?? new Date().toISOString(),
      open: row.open ?? 0,
      high: row.high ?? row.open ?? 0,
      low: row.low ?? row.open ?? 0,
      close: row.close ?? row.open ?? 0,
      volume: row.volume,
      outcomeId: input.outcomeId ?? null,
    }));
}

async function resolveDetailCandles(input: {
  market: MarketType;
  symbol: string;
  interval: string;
  limit: number;
  outcomeId?: string | null;
}) {
  if (isDatabaseConfigured()) {
    const databaseCandles = await getDetailCandlesFromDatabase(input);
    if (databaseCandles.length) {
      return {
        candles: databaseCandles,
        source: 'db',
      } satisfies DetailCandleResult;
    }
  }

  const normalizedOutcomeId = input.outcomeId ?? null;
  const candles =
    input.market === 'prediction' && normalizedOutcomeId
      ? getCandles(input.symbol, input.market, input.interval, input.limit, normalizedOutcomeId)
      : getCandles(input.symbol, input.market, input.interval, input.limit);
  if (candles.length) {
    return {
      candles,
      source: 'db',
    } satisfies DetailCandleResult;
  }

  return fetchLiveDetailCandles(input);
}

export async function buildQuoteContext(
  market: MarketType,
  requests: Array<{
    symbol: string;
    outcomeId?: string | null;
    exactOutcomeRequired?: boolean;
  }>
) {
  const dedupedRequests = new Map<
    string,
    {
      symbol: string;
      outcomeId?: string | null;
      exactOutcomeRequired?: boolean;
    }
  >();

  for (const request of requests) {
    const key = normalizeLookupKey(
      request.outcomeId ? `${request.symbol}::${request.outcomeId}` : request.symbol
    );
    if (!dedupedRequests.has(key)) {
      dedupedRequests.set(key, request);
    }
  }

  const results = await Promise.all(
    [...dedupedRequests.entries()].map(async ([key, request]) => ({
      key,
      result: await resolveDetailQuote({
        market,
        symbol: request.symbol,
        outcomeId: request.outcomeId ?? null,
        exactOutcomeRequired: request.exactOutcomeRequired,
      }),
    }))
  );

  return new Map(results.map((entry) => [entry.key, entry.result]));
}

export async function buildCandleContext(
  market: MarketType,
  symbols: string[],
  interval: string,
  limit: number
) {
  const uniqueSymbols = [...new Set(symbols)].filter(Boolean);
  const results = await Promise.all(
    uniqueSymbols.map(async (symbol) => ({
      key: normalizeLookupKey(symbol),
      result: await resolveDetailCandles({
        market,
        symbol,
        interval,
        limit,
      }),
    }))
  );

  return new Map(results.map((entry) => [entry.key, entry.result]));
}

export function buildSyntheticPredictionOutcomeQuote(
  marketDetails: NonNullable<PredictionMarketDetailsView>,
  outcome: NonNullable<NonNullable<PredictionMarketDetailsView>['outcomes'][number]>
) {
  if (outcome.price == null) {
    return null;
  }

  return {
    market: 'prediction' as const,
    provider: 'polymarket-market-details',
    symbol: marketDetails.symbol,
    lastPrice: outcome.price,
    bid: outcome.price,
    ask: outcome.price,
    midpoint: outcome.price,
    spread: 0,
    bidSize: null,
    askSize: null,
    volume24h: marketDetails.volume_24h ?? null,
    change24h: null,
    timestamp: marketDetails.quote?.timestamp ?? new Date().toISOString(),
    outcomeId: outcome.id ?? null,
    outcomeName: outcome.name,
  } satisfies MarketQuote;
}

async function getPredictionOutcomeQuoteFallback(input: {
  symbol: string;
  outcomeId: string;
  marketDetails: PredictionMarketDetailsView | null;
}) {
  const exactQuote = await resolveDetailQuote({
    market: 'prediction',
    symbol: input.symbol,
    outcomeId: input.outcomeId,
    exactOutcomeRequired: true,
  });
  if (exactQuote.quote) {
    return exactQuote;
  }

  const matchedOutcome =
    input.marketDetails?.outcomes.find((outcome) => outcome.id === input.outcomeId) ?? null;
  const syntheticQuote =
    input.marketDetails && matchedOutcome
      ? buildSyntheticPredictionOutcomeQuote(input.marketDetails, matchedOutcome)
      : null;
  if (syntheticQuote) {
    return {
      quote: syntheticQuote,
      source: 'market_details',
    } satisfies DetailQuoteResult;
  }

  return {
    quote: null,
    source: 'unavailable',
    error: 'quote_unavailable',
  } satisfies DetailQuoteResult;
}

export async function buildPredictionOutcomeQuoteContext(
  objects: NormalizedDetailObject[],
  marketDetailsMap: Map<string, PredictionMarketDetailsView | null>,
  eventResolutionMap: Map<string, PredictionEventResolution>
) {
  const requests = [
    ...new Map(
      objects
        .flatMap((item) => {
          const details =
            marketDetailsMap.get(item.objectId) ??
            marketDetailsMap.get(item.symbol) ??
            null;
          const eventMarkets =
            eventResolutionMap.get(item.objectId)?.event?.markets ?? [];
          const candidateMarkets = details ? [details] : eventMarkets;
          return candidateMarkets.flatMap((candidate) =>
            candidate.outcomes
              .filter((outcome) => Boolean(outcome.id))
              .map((outcome) => ({
                key: normalizeLookupKey(`${candidate.symbol}::${outcome.id}`),
                symbol: candidate.symbol,
                outcomeId: outcome.id as string,
                marketDetails: candidate,
              }))
          );
        })
        .map((item) => [item.key, item] as const)
    ).values(),
  ];

  const results = await Promise.all(
    requests.map(async (request) => ({
      key: request.key,
      result: await getPredictionOutcomeQuoteFallback({
        symbol: request.symbol,
        outcomeId: request.outcomeId,
        marketDetails: request.marketDetails,
      }),
    }))
  );

  return new Map(results.map((entry) => [entry.key, entry.result]));
}

export function resolvePredictionQuoteResult(input: {
  item: NormalizedDetailObject;
  quoteContext: Map<string, DetailQuoteResult>;
  predictionOutcomeQuoteContext: Map<string, DetailQuoteResult>;
  marketDetails: PredictionMarketDetailsView | null;
}) {
  const { item, quoteContext, predictionOutcomeQuoteContext, marketDetails } = input;

  if (item.outcomeKey && marketDetails?.outcomes?.length) {
    const matchedOutcome =
      marketDetails.outcomes.find(
        (outcome) =>
          normalizeOutcomeObjectKey(outcome.name) ===
          normalizeOutcomeObjectKey(item.outcomeKey ?? '')
      ) ?? null;

    if (matchedOutcome?.id) {
      const outcomeQuote = predictionOutcomeQuoteContext.get(
        normalizeLookupKey(`${marketDetails.symbol}::${matchedOutcome.id}`)
      );
      if (outcomeQuote) {
        return outcomeQuote;
      }
    }

    return undefined;
  }

  return quoteContext.get(normalizeLookupKey(item.symbol));
}
