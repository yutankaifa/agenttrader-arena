import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import type { MarketInstrument, MarketType } from '@/db/schema';
import { createId } from '@/db/id';
import { readStore, updateStore } from '@/db/store';
import {
  addRecentSymbols,
  isRedisConfigured,
  setQuotes,
  setSymbolList,
} from '@/lib/redis';
import { roundUsd, toIsoString } from '@/lib/utils';

import { binanceAdapter } from './binance';
import { massiveAdapter } from './massive';
import {
  getPolymarketEventDetails as fetchPolymarketEventDetails,
  getPolymarketMarketDetails as fetchPolymarketMarketDetails,
  polymarketAdapter,
  searchPolymarketEvents as fetchPolymarketEventsByQuery,
} from './polymarket';
import type {
  MarketAdapter,
  MarketCandleView,
  MarketQuote,
  PredictionEventDetails,
  PredictionMarketDetails,
} from './types';

export { binanceAdapter } from './binance';
export { massiveAdapter } from './massive';
export {
  getPolymarketEventDetails as getLivePolymarketEventDetails,
  getPolymarketMarketDetails as getLivePolymarketMarketDetails,
  polymarketAdapter,
  searchPolymarketEvents as searchLivePolymarketEvents,
} from './polymarket';
export type {
  MarketAdapter,
  MarketCandleView,
  MarketQuote,
  PredictionEventDetails,
  PredictionMarketDetails,
} from './types';

const adapters: Record<MarketType, MarketAdapter> = {
  stock: massiveAdapter,
  crypto: binanceAdapter,
  prediction: polymarketAdapter,
};

const instrumentCache = new Map<string, MarketInstrument>();
const latestQuoteCache = new Map<string, MarketQuote>();
const candleCache = new Map<string, MarketCandleView[]>();

function isSimOnlyMode() {
  return process.env.AGENTTRADER_MARKET_DATA_MODE?.trim().toLowerCase() === 'sim';
}

function buildInstrumentLookupKey(symbol: string, market?: MarketType) {
  return `${market ?? 'unknown'}::${symbol.trim().toUpperCase()}`;
}

function buildQuoteLookupKey(symbol: string, market?: MarketType, outcomeId?: string | null) {
  return `${buildInstrumentLookupKey(symbol, market)}::${outcomeId ?? 'spot'}`;
}

function buildCandleSeriesKey(input: {
  symbol: string;
  market: MarketType;
  interval: string;
  outcomeId?: string | null;
}) {
  return [
    input.market,
    input.symbol.trim().toUpperCase(),
    input.interval,
    input.outcomeId ?? 'spot',
  ].join('::');
}

function rememberInstrument(instrument: MarketInstrument) {
  instrumentCache.set(buildInstrumentLookupKey(instrument.symbol, instrument.market), instrument);
}

function rememberQuote(quote: MarketQuote) {
  latestQuoteCache.set(
    buildQuoteLookupKey(quote.symbol, quote.market, quote.outcomeId ?? null),
    quote
  );
  if (quote.outcomeId) {
    latestQuoteCache.set(buildQuoteLookupKey(quote.symbol, quote.market, null), quote);
  }
}

function rememberCandle(candle: MarketCandleView) {
  const key = buildCandleSeriesKey(candle);
  const current = candleCache.get(key) ?? [];
  const next = [...current, candle]
    .sort((a, b) => a.openTime.localeCompare(b.openTime))
    .slice(-500);
  candleCache.set(key, next);
}

function normalizeRequestedSymbol(marketType: MarketType, symbol: string) {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return '';
  }

  return marketType === 'prediction' ? trimmed : trimmed.toUpperCase();
}

function findInstrument(symbol: string, market?: MarketType) {
  if (isDatabaseConfigured()) {
    if (!market) {
      return null;
    }

    const cached = instrumentCache.get(buildInstrumentLookupKey(symbol, market));
    return cached ?? null;
  }

  const store = readStore();
  return (
    store.marketInstruments.find(
      (item) =>
        item.symbol.toUpperCase() === symbol.toUpperCase() &&
        (!market || item.market === market)
    ) ?? null
  );
}

function buildCandleKey(candle: Pick<MarketCandleView, 'market' | 'symbol' | 'interval' | 'openTime'> & {
  outcomeId?: string | null;
}) {
  return [
    candle.market,
    candle.symbol.toUpperCase(),
    candle.interval,
    candle.openTime,
    candle.outcomeId ?? 'spot',
  ].join('::');
}

function getAdapter(marketType: MarketType) {
  return adapters[marketType] ?? null;
}

function quoteFromInstrument(
  store: ReturnType<typeof readStore>,
  instrument: MarketInstrument,
  outcomeId?: string | null
) {
  return (
    store.marketDataSnapshots
      .filter(
        (item) =>
          item.instrumentId === instrument.id &&
          (outcomeId === undefined || (item.outcomeId ?? null) === (outcomeId ?? null))
      )
      .sort((a, b) => b.quoteTs.localeCompare(a.quoteTs))[0] ?? null
  );
}

function nextPrice(price: number, market: MarketType) {
  const ratio = market === 'prediction' ? 0.018 : market === 'crypto' ? 0.012 : 0.006;
  const drift = (Math.random() - 0.5) * price * ratio;
  if (market === 'prediction') {
    return Math.min(0.99, Math.max(0.01, roundUsd(price + drift)));
  }
  return Math.max(0.01, roundUsd(price + drift));
}

function buildDepthSnapshot(input: {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  timestamp: string;
}) {
  return JSON.stringify({
    bids:
      input.bid != null
        ? [{ price: input.bid, size: input.bidSize ?? Number.MAX_SAFE_INTEGER }]
        : [],
    asks:
      input.ask != null
        ? [{ price: input.ask, size: input.askSize ?? Number.MAX_SAFE_INTEGER }]
        : [],
    snapshot_at: input.timestamp,
  });
}

async function saveQuoteSnapshots(quotes: MarketQuote[]) {
  if (!quotes.length) {
    return 0;
  }

  for (const quote of quotes) {
    rememberQuote(quote);
  }

  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    for (const quote of quotes) {
      const instrumentRows = await sql<
        {
          id: string;
        }[]
      >`
        select id
        from market_instruments
        where upper(symbol) = upper(${quote.symbol})
          and market = ${quote.market}
        limit 1
      `;
      const instrumentId =
        instrumentRows[0]?.id ??
        `${quote.market}_${quote.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`;

      await sql`
        insert into market_data_snapshots (
          id,
          instrument_id,
          provider,
          quote_ts,
          last_price,
          bid,
          ask,
          midpoint,
          spread,
          bid_size,
          ask_size,
          depth_snapshot,
          raw_payload
        ) values (
          ${createId('quote')},
          ${quote.outcomeId ? `${quote.symbol}::${quote.outcomeId}` : instrumentId},
          ${quote.provider},
          ${quote.timestamp},
          ${quote.lastPrice},
          ${quote.bid},
          ${quote.ask},
          ${quote.midpoint},
          ${quote.spread},
          ${quote.bidSize},
          ${quote.askSize},
          ${
            quote.depthSnapshot ??
            buildDepthSnapshot({
              bid: quote.bid,
              ask: quote.ask,
              bidSize: quote.bidSize,
              askSize: quote.askSize,
              timestamp: quote.timestamp,
            })
          },
          ${null}
        )
      `;
    }

    return quotes.length;
  }

  await updateStore((store) => {
    for (const quote of quotes) {
      const instrument = store.marketInstruments.find(
        (item) =>
          item.symbol.toUpperCase() === quote.symbol.toUpperCase() &&
          item.market === quote.market
      );

      store.marketDataSnapshots.push({
        id: createId('quote'),
        instrumentId:
          instrument?.id ??
          `${quote.market}_${quote.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`,
        market: quote.market,
        symbol: quote.symbol,
        provider: quote.provider,
        quoteTs: quote.timestamp,
        lastPrice: quote.lastPrice,
        bid: quote.bid,
        ask: quote.ask,
        midpoint: quote.midpoint,
        spread: quote.spread,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        depthSnapshot:
          quote.depthSnapshot ??
          buildDepthSnapshot({
            bid: quote.bid,
            ask: quote.ask,
            bidSize: quote.bidSize,
            askSize: quote.askSize,
            timestamp: quote.timestamp,
          }),
        volume24h: quote.volume24h,
        change24h: quote.change24h,
        outcomeId: quote.outcomeId ?? null,
        outcomeName: quote.outcomeName ?? null,
        rawPayload: null,
      });
    }
  });

  return quotes.length;
}

async function saveCandleSnapshots(candles: MarketCandleView[]) {
  if (!candles.length) {
    return 0;
  }

  for (const candle of candles) {
    rememberCandle(candle);
  }

  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    let saved = 0;
    for (const candle of candles) {
      const instrumentRows = await sql<{ id: string }[]>`
        select id
        from market_instruments
        where upper(symbol) = upper(${candle.symbol})
          and market = ${candle.market}
        limit 1
      `;
      const baseInstrumentId =
        instrumentRows[0]?.id ??
        `${candle.market}_${candle.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`;
      const instrumentId =
        candle.market === 'prediction' && candle.outcomeId
          ? `${candle.symbol}::${candle.outcomeId}`
          : baseInstrumentId;
      const duplicateRows = await sql<{ id: string }[]>`
        select id
        from market_candles
        where instrument_id = ${instrumentId}
          and interval = ${candle.interval}
          and open_time = ${candle.openTime}
        limit 1
      `;
      if (duplicateRows[0]) {
        continue;
      }

      await sql`
        insert into market_candles (
          id,
          instrument_id,
          market,
          interval,
          open_time,
          close_time,
          open,
          high,
          low,
          close,
          volume,
          trade_count,
          vwap,
          created_at
        ) values (
          ${createId('candle')},
          ${instrumentId},
          ${candle.market},
          ${candle.interval},
          ${candle.openTime},
          ${candle.closeTime},
          ${candle.open},
          ${candle.high},
          ${candle.low},
          ${candle.close},
          ${candle.volume},
          ${null},
          ${roundUsd((candle.open + candle.close) / 2)},
          ${new Date().toISOString()}
        )
      `;
      saved += 1;
    }

    return saved;
  }

  let saved = 0;
  await updateStore((store) => {
    const existingKeys = new Set(
      store.marketCandles.map((item) =>
        buildCandleKey({
          market: item.market,
          symbol: item.symbol,
          interval: item.interval,
          openTime: item.openTime,
          outcomeId: item.outcomeId ?? null,
        })
      )
    );

    for (const candle of candles) {
      const key = buildCandleKey(candle);
      if (existingKeys.has(key)) {
        continue;
      }

      const instrument = store.marketInstruments.find(
        (item) =>
          item.symbol.toUpperCase() === candle.symbol.toUpperCase() &&
          item.market === candle.market
      );

      store.marketCandles.push({
        id: createId('candle'),
        instrumentId:
          instrument?.id ??
          `${candle.market}_${candle.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`,
        market: candle.market,
        symbol: candle.symbol,
        interval: candle.interval,
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        tradeCount: null,
        vwap: roundUsd((candle.open + candle.close) / 2),
        outcomeId: candle.outcomeId ?? null,
      });

      existingKeys.add(key);
      saved += 1;
    }
  });

  return saved;
}

async function syncInstrumentFromQuote(quote: MarketQuote) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const existingRows = await sql<
      {
        id: string;
        metadata: string | null;
      }[]
    >`
      select id, metadata
      from market_instruments
      where upper(symbol) = upper(${quote.symbol})
        and market = ${quote.market}
      limit 1
    `;
    const existing = existingRows[0] ?? null;
    const nextMetadata =
      quote.market === 'prediction' && quote.outcomeId && quote.outcomeName
        ? (() => {
            const current = parseInstrumentMetadata(existing?.metadata ?? null) ?? {};
            const outcomes = current.outcomes ?? [];
            if (!outcomes.some((item) => item.id === quote.outcomeId)) {
              outcomes.push({
                id: quote.outcomeId,
                name: quote.outcomeName,
                price: quote.lastPrice,
              });
            }
            return JSON.stringify({
              ...current,
              active: current.active ?? true,
              closed: current.closed ?? false,
              marketStatus: current.marketStatus ?? 'active',
              outcomes,
            });
          })()
        : existing?.metadata ?? null;

    if (existing) {
      rememberInstrument({
        id: existing.id,
        market: quote.market,
        symbol: quote.symbol,
        displayName: quote.symbol.toUpperCase(),
        provider: quote.provider,
        providerSymbol: quote.symbol,
        providerMarketId: null,
        assetId: null,
        isActive: true,
        metadata: nextMetadata ? (parseInstrumentMetadata(nextMetadata) as MarketInstrument['metadata']) : null,
      });
      await sql`
        update market_instruments
        set
          provider = ${quote.provider},
          provider_symbol = ${quote.symbol},
          is_active = ${true},
          metadata = ${nextMetadata}
        where id = ${existing.id}
      `;
      return;
    }

    await sql`
      insert into market_instruments (
        id,
        market,
        symbol,
        display_name,
        provider,
        provider_symbol,
        provider_market_id,
        asset_id,
        is_active,
        metadata
      ) values (
        ${`${quote.market}_${quote.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`},
        ${quote.market},
        ${quote.symbol},
        ${quote.symbol.toUpperCase()},
        ${quote.provider},
        ${quote.symbol},
        ${null},
        ${null},
        ${true},
        ${
          quote.market === 'prediction' && quote.outcomeId && quote.outcomeName
            ? JSON.stringify({
                active: true,
                closed: false,
                acceptingOrders: true,
                marketStatus: 'active',
                outcomes: [
                  {
                    id: quote.outcomeId,
                    name: quote.outcomeName,
                    price: quote.lastPrice,
                  },
                ],
              })
            : null
        }
      )
    `;
    rememberInstrument({
      id: `${quote.market}_${quote.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`,
      market: quote.market,
      symbol: quote.symbol,
      displayName: quote.symbol.toUpperCase(),
      provider: quote.provider,
      providerSymbol: quote.symbol,
      providerMarketId: null,
      assetId: null,
      isActive: true,
      metadata:
        quote.market === 'prediction' && quote.outcomeId && quote.outcomeName
          ? ({
              active: true,
              closed: false,
              acceptingOrders: true,
              marketStatus: 'active',
              outcomes: [
                {
                  id: quote.outcomeId,
                  name: quote.outcomeName,
                  price: quote.lastPrice,
                },
              ],
            } as MarketInstrument['metadata'])
          : null,
    });
    return;
  }

  await updateStore((store) => {
    const existing = store.marketInstruments.find(
      (item) =>
        item.symbol.toUpperCase() === quote.symbol.toUpperCase() &&
        item.market === quote.market
    );

    if (existing) {
      existing.provider = quote.provider;
      existing.providerSymbol = quote.symbol;
      existing.isActive = true;
      if (quote.market === 'prediction' && quote.outcomeId && quote.outcomeName) {
        const outcomes = existing.metadata?.outcomes ?? [];
        const outcomeExists = outcomes.some((item) => item.id === quote.outcomeId);
        if (!outcomeExists) {
          outcomes.push({
            id: quote.outcomeId,
            name: quote.outcomeName,
            price: quote.lastPrice,
          });
        }
        existing.metadata = {
          ...(existing.metadata ?? {}),
          active: existing.metadata?.active ?? true,
          closed: existing.metadata?.closed ?? false,
          marketStatus: existing.metadata?.marketStatus ?? 'active',
          outcomes,
        };
      }
      return;
    }

    store.marketInstruments.push({
      id: `${quote.market}_${quote.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`,
      market: quote.market,
      symbol: quote.symbol,
      displayName: quote.symbol.toUpperCase(),
      provider: quote.provider,
      providerSymbol: quote.symbol,
      providerMarketId: null,
      assetId: null,
      isActive: true,
      metadata:
        quote.market === 'prediction' && quote.outcomeId && quote.outcomeName
          ? {
              active: true,
              closed: false,
              acceptingOrders: true,
              marketStatus: 'active',
              outcomes: [
                {
                  id: quote.outcomeId,
                  name: quote.outcomeName,
                  price: quote.lastPrice,
                },
              ],
            }
          : null,
    });
  });
}

async function syncPredictionInstrument(details: PredictionMarketDetails) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const existingRows = await sql<{ id: string }[]>`
      select id
      from market_instruments
      where upper(symbol) = upper(${details.symbol})
        and market = 'prediction'
      limit 1
    `;
    const metadata = JSON.stringify({
      active: details.active ?? true,
      closed: details.closed ?? false,
      acceptingOrders: details.accepting_orders ?? true,
      marketStatus: details.market_status ?? 'active',
      resolvesAt: details.resolves_at ?? undefined,
      resolvedOutcomeId: details.resolved_outcome_id ?? null,
      outcomes: details.outcomes.map((outcome) => ({
        id: outcome.id ?? '',
        name: outcome.name,
        price: outcome.price ?? 0,
      })),
      title: details.title ?? details.name ?? details.symbol,
      description: details.description ?? null,
      eventTitle: details.event_title ?? null,
      category: details.category ?? null,
      archived: details.archived ?? null,
      liquidity: details.liquidity ?? null,
      volume24h: details.volume_24h ?? null,
      rules: details.rules ?? null,
      resolutionSource: details.resolution_source ?? null,
      clobTokenIds: details.clob_token_ids ?? null,
    });

    if (existingRows[0]) {
      rememberInstrument({
        id: existingRows[0].id,
        market: 'prediction',
        symbol: details.symbol,
        displayName: details.name ?? details.symbol,
        provider: 'polymarket',
        providerSymbol: details.symbol,
        providerMarketId: details.condition_id ?? null,
        assetId: null,
        isActive: details.active ?? true,
        metadata: parseInstrumentMetadata(metadata) as MarketInstrument['metadata'],
      });
      await sql`
        update market_instruments
        set
          display_name = ${details.name ?? details.symbol},
          provider = ${'polymarket'},
          provider_symbol = ${details.symbol},
          provider_market_id = ${details.condition_id ?? null},
          is_active = ${details.active ?? true},
          metadata = ${metadata}
        where id = ${existingRows[0].id}
      `;
      return;
    }

    await sql`
      insert into market_instruments (
        id,
        market,
        symbol,
        display_name,
        provider,
        provider_symbol,
        provider_market_id,
        asset_id,
        is_active,
        metadata
      ) values (
        ${`prediction_${details.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`},
        ${'prediction'},
        ${details.symbol},
        ${details.name ?? details.symbol},
        ${'polymarket'},
        ${details.symbol},
        ${details.condition_id ?? null},
        ${null},
        ${details.active ?? true},
        ${metadata}
      )
    `;
    rememberInstrument({
      id: `prediction_${details.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`,
      market: 'prediction',
      symbol: details.symbol,
      displayName: details.name ?? details.symbol,
      provider: 'polymarket',
      providerSymbol: details.symbol,
      providerMarketId: details.condition_id ?? null,
      assetId: null,
      isActive: details.active ?? true,
      metadata: parseInstrumentMetadata(metadata) as MarketInstrument['metadata'],
    });
    return;
  }

  await updateStore((store) => {
    const existing = store.marketInstruments.find(
      (item) =>
        item.symbol.toUpperCase() === details.symbol.toUpperCase() &&
        item.market === 'prediction'
    );

    const nextMetadata = {
      active: details.active ?? true,
      closed: details.closed ?? false,
      acceptingOrders: details.accepting_orders ?? true,
      marketStatus: details.market_status ?? 'active',
      resolvesAt: details.resolves_at ?? undefined,
      resolvedOutcomeId: details.resolved_outcome_id ?? null,
      outcomes: details.outcomes.map((outcome) => ({
        id: outcome.id ?? '',
        name: outcome.name,
        price: outcome.price ?? 0,
      })),
    };

    if (existing) {
      existing.displayName = details.name ?? existing.displayName;
      existing.provider = 'polymarket';
      existing.providerSymbol = details.symbol;
      existing.providerMarketId = details.condition_id ?? existing.providerMarketId;
      existing.isActive = details.active ?? existing.isActive;
      existing.metadata = nextMetadata;
      return;
    }

    store.marketInstruments.push({
      id: `prediction_${details.symbol.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`,
      market: 'prediction',
      symbol: details.symbol,
      displayName: details.name ?? details.symbol,
      provider: 'polymarket',
      providerSymbol: details.symbol,
      providerMarketId: details.condition_id ?? null,
      assetId: null,
      isActive: details.active ?? true,
      metadata: nextMetadata,
    });
  });
}

async function maybeBackfillRedis(marketType: MarketType, quotes: MarketQuote[]) {
  if (!quotes.length || !isRedisConfigured()) {
    return;
  }

  try {
    await setQuotes(quotes);
    await setSymbolList(
      marketType,
      [...new Set(quotes.map((quote) => quote.symbol.toUpperCase()))]
    );
    await addRecentSymbols(
      marketType,
      quotes.map((quote) => quote.symbol.toUpperCase())
    );
  } catch (error) {
    console.warn(`[market-adapter] redis backfill failed for ${marketType}:`, error);
  }
}

async function refreshLiveMarketData(
  marketType: MarketType,
  symbols?: string[],
  options?: { candlesInterval?: string; candlesLimit?: number }
) {
  if (isSimOnlyMode()) {
    return null;
  }

  const adapter = getAdapter(marketType);
  if (!adapter) {
    return null;
  }

  const targetSymbols =
    symbols?.length && symbols.some(Boolean)
      ? [
          ...new Set(
            symbols
              .map((item) => normalizeRequestedSymbol(marketType, item))
              .filter(Boolean)
          ),
        ]
      : await adapter.getTopSymbols(20);
  if (!targetSymbols.length) {
    return null;
  }

  const quotes = await adapter.getQuotes(targetSymbols);
  if (!quotes.length) {
    return null;
  }

  await Promise.allSettled(quotes.map((quote) => syncInstrumentFromQuote(quote)));
  if (marketType === 'prediction') {
    const detailResults = await Promise.allSettled(
      targetSymbols.map((symbol) => fetchPolymarketMarketDetails(symbol))
    );
    await Promise.allSettled(
      detailResults
        .map((result) => (result.status === 'fulfilled' ? result.value : null))
        .filter((item): item is PredictionMarketDetails => Boolean(item))
        .map((details) => syncPredictionInstrument(details))
    );
  }

  const savedQuotes = await saveQuoteSnapshots(quotes);
  await maybeBackfillRedis(marketType, quotes);

  const candleInterval = options?.candlesInterval ?? '1h';
  const candleLimit = options?.candlesLimit ?? 24;
  const candleSymbols =
    marketType === 'prediction'
      ? quotes
          .filter((quote) => quote.outcomeId)
          .slice(0, Math.max(targetSymbols.length, 1))
          .map((quote) => `${quote.symbol}::${quote.outcomeId}`)
      : targetSymbols;
  const candleBatches = await Promise.all(
    [...new Set(candleSymbols)].map((symbol) =>
      adapter.getCandles(symbol, candleInterval, candleLimit)
    )
  );
  const savedCandles = await saveCandleSnapshots(candleBatches.flat());

  return {
    quotes: savedQuotes,
    candles: savedCandles,
    errors: Math.max(0, targetSymbols.length - savedQuotes),
    source: adapter.name,
  };
}

async function simulateMarketData(
  marketType: MarketType,
  symbols?: string[]
) {
  const result = await updateStore((store) => {
    const now = new Date();
    const selected = store.marketInstruments.filter((instrument) => {
      const symbolMatch =
        !symbols?.length ||
        symbols.some(
          (item) => item.trim().toUpperCase() === instrument.symbol.toUpperCase()
        );
      return instrument.market === marketType && symbolMatch;
    });

    let quotes = 0;
    let candles = 0;
    let errors = 0;

    for (const instrument of selected) {
      const existingQuotes = store.marketDataSnapshots
        .filter((item) => item.instrumentId === instrument.id)
        .sort((a, b) => b.quoteTs.localeCompare(a.quoteTs));
      if (!existingQuotes.length) {
        errors += 1;
        continue;
      }

      const quoteBuckets =
        instrument.market === 'prediction'
          ? [...new Set(existingQuotes.map((item) => item.outcomeId ?? 'spot'))]
          : ['spot'];

      for (const bucket of quoteBuckets) {
        const previous = quoteFromInstrument(
          store,
          instrument,
          bucket === 'spot' ? undefined : bucket
        );
        if (!previous) {
          errors += 1;
          continue;
        }

        const lastPrice = nextPrice(previous.lastPrice, instrument.market);
        const spread = instrument.market === 'prediction' ? 0.04 : lastPrice * 0.0012;
        const bid = roundUsd(lastPrice - spread / 2);
        const ask = roundUsd(lastPrice + spread / 2);
        store.marketDataSnapshots.push({
          id: createId('quote'),
          instrumentId: instrument.id,
          market: instrument.market,
          symbol: instrument.symbol,
          provider: instrument.provider,
          quoteTs: now.toISOString(),
          lastPrice,
          bid,
          ask,
          midpoint: lastPrice,
          spread: roundUsd(spread),
          bidSize: previous.bidSize,
          askSize: previous.askSize,
          depthSnapshot:
            previous.depthSnapshot ??
            buildDepthSnapshot({
              bid,
              ask,
              bidSize: previous.bidSize,
              askSize: previous.askSize,
              timestamp: now.toISOString(),
            }),
          volume24h: previous.volume24h,
          change24h: roundUsd((Math.random() - 0.5) * 6),
          outcomeId: previous.outcomeId,
          outcomeName: previous.outcomeName,
          rawPayload: null,
        });
        quotes += 1;

        store.marketCandles.push({
          id: createId('candle'),
          instrumentId: instrument.id,
          market: instrument.market,
          symbol: instrument.symbol,
          interval: '1h',
          openTime: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          closeTime: now.toISOString(),
          open: previous.lastPrice,
          high: Math.max(previous.lastPrice, lastPrice),
          low: Math.min(previous.lastPrice, lastPrice),
          close: lastPrice,
          volume: instrument.market === 'prediction' ? null : previous.volume24h,
          tradeCount: null,
          vwap: roundUsd((previous.lastPrice + lastPrice) / 2),
          outcomeId: previous.outcomeId,
        });
        candles += 1;
      }
    }

    return { quotes, candles, errors, source: 'sim-market' };
  });

  return result;
}

function buildStoredPredictionDetails(
  instrument: MarketInstrument
): PredictionMarketDetails {
  const outcomes =
    instrument.metadata?.outcomes?.map((outcome) => ({
      id: outcome.id ?? null,
      name: outcome.name,
      price: outcome.price ?? null,
    })) ?? [];
  const primaryOutcomeId = outcomes.find((item) => item.id)?.id ?? undefined;

  return {
    symbol: instrument.symbol,
    name: instrument.displayName,
    active: instrument.metadata?.active ?? true,
    closed: instrument.metadata?.closed ?? false,
    accepting_orders: instrument.metadata?.acceptingOrders ?? true,
    market_status: instrument.metadata?.marketStatus ?? 'active',
    resolves_at: instrument.metadata?.resolvesAt ?? null,
    resolved_outcome_id: instrument.metadata?.resolvedOutcomeId ?? null,
    outcomes,
    quote: getLatestQuote(instrument.symbol, 'prediction', primaryOutcomeId),
  };
}

function parseInstrumentMetadata(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as {
          active?: boolean;
          closed?: boolean;
          acceptingOrders?: boolean;
          marketStatus?: string;
          resolvesAt?: string;
          resolvedOutcomeId?: string | null;
          outcomes?: Array<{ id?: string | null; name?: string; price?: number | null }>;
          volume24h?: number | null;
          liquidity?: number | null;
          rules?: string | null;
          resolutionSource?: string | null;
          description?: string | null;
          title?: string | null;
          eventTitle?: string | null;
          category?: string | null;
          archived?: boolean | null;
          clobTokenIds?: string[] | null;
        })
      : null;
  } catch {
    return null;
  }
}

async function getPredictionMarketDetailsFromDatabase(symbol: string) {
  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      symbol: string;
      display_name: string | null;
      metadata: string | null;
      provider: string;
      provider_market_id: string | null;
      is_active: boolean | null;
    }[]
  >`
    select
      id,
      symbol,
      display_name,
      metadata,
      provider,
      provider_market_id,
      is_active
    from market_instruments
    where market = 'prediction'
      and upper(symbol) = upper(${symbol})
    limit 1
  `;
  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  const metadata = parseInstrumentMetadata(row.metadata);
  const outcomes =
    metadata?.outcomes?.map((outcome) => ({
      id: outcome.id ?? null,
      name: outcome.name ?? 'Unknown',
      price: outcome.price ?? null,
    })) ?? [];
  const primaryOutcomeId = outcomes.find((item) => item.id)?.id ?? null;
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
    where instrument_id = ${primaryOutcomeId ? `${row.symbol}::${primaryOutcomeId}` : row.symbol}
       or instrument_id = ${row.symbol}
       or instrument_id = ${row.id}
    order by quote_ts desc
    limit 1
  `;
  const quoteRow = quoteRows[0] ?? null;

  const result = {
    symbol: row.symbol,
    name: metadata?.title ?? row.display_name ?? row.symbol,
    title: metadata?.title ?? row.display_name ?? row.symbol,
    description: metadata?.description ?? null,
    event_title: metadata?.eventTitle ?? null,
    category: metadata?.category ?? null,
    active: metadata?.active ?? row.is_active ?? true,
    closed: metadata?.closed ?? false,
    archived: metadata?.archived ?? null,
    accepting_orders: metadata?.acceptingOrders ?? true,
    market_status: metadata?.marketStatus ?? 'active',
    resolves_at: metadata?.resolvesAt ?? null,
    resolved_outcome_id: metadata?.resolvedOutcomeId ?? null,
    rules: metadata?.rules ?? null,
    resolution_source: metadata?.resolutionSource ?? null,
    volume_24h: metadata?.volume24h ?? null,
    liquidity: metadata?.liquidity ?? null,
    outcomes,
    condition_id: row.provider_market_id ?? null,
    clob_token_ids: metadata?.clobTokenIds ?? undefined,
    quote: quoteRow
      ? {
          market: 'prediction',
          provider: quoteRow.provider,
          symbol: row.symbol,
          lastPrice: quoteRow.last_price ?? 0,
          bid: quoteRow.bid,
          ask: quoteRow.ask,
          midpoint: quoteRow.midpoint,
          spread: quoteRow.spread,
          bidSize: quoteRow.bid_size,
          askSize: quoteRow.ask_size,
          depthSnapshot: quoteRow.depth_snapshot,
          volume24h: metadata?.volume24h ?? null,
          change24h: null,
          timestamp: toIsoString(quoteRow.quote_ts) ?? new Date().toISOString(),
          outcomeId: primaryOutcomeId,
          outcomeName:
            outcomes.find((outcome) => outcome.id === primaryOutcomeId)?.name ?? null,
        }
      : null,
  } satisfies PredictionMarketDetails;
  rememberInstrument({
    id: row.id,
    market: 'prediction',
    symbol: row.symbol,
    displayName: row.display_name ?? row.symbol,
    provider: row.provider,
    providerSymbol: row.symbol,
    providerMarketId: row.provider_market_id,
    assetId: null,
    isActive: row.is_active ?? true,
    metadata: metadata as MarketInstrument['metadata'],
  });
  if (result.quote) {
    rememberQuote(result.quote);
  }
  return result;
}

export function getLatestQuote(
  symbol: string,
  market?: MarketType,
  outcomeId?: string | null
) {
  if (isDatabaseConfigured()) {
    if (!market) {
      return null;
    }

    const exact = latestQuoteCache.get(buildQuoteLookupKey(symbol, market, outcomeId ?? null));
    if (exact) {
      return exact;
    }
    const spot = latestQuoteCache.get(buildQuoteLookupKey(symbol, market, null));
    return spot ?? null;
  }

  const store = readStore();
  const snapshots = store.marketDataSnapshots
    .filter(
      (item) =>
        item.symbol.toUpperCase() === symbol.toUpperCase() &&
        (!market || item.market === market) &&
        (outcomeId === undefined || (item.outcomeId ?? null) === (outcomeId ?? null))
    )
    .sort((a, b) => b.quoteTs.localeCompare(a.quoteTs));

  const snapshot = snapshots[0];
  if (!snapshot) {
    return null;
  }

  return {
    market: snapshot.market,
    provider: snapshot.provider,
    symbol: snapshot.symbol,
    lastPrice: snapshot.lastPrice,
    bid: snapshot.bid,
    ask: snapshot.ask,
    midpoint: snapshot.midpoint,
    spread: snapshot.spread,
    bidSize: snapshot.bidSize,
    askSize: snapshot.askSize,
    volume24h: snapshot.volume24h,
    change24h: snapshot.change24h,
    timestamp: snapshot.quoteTs,
    outcomeId: snapshot.outcomeId,
    outcomeName: snapshot.outcomeName,
  } satisfies MarketQuote;
}

export function getCandles(
  symbol: string,
  market?: MarketType,
  interval = '1h',
  limit = 24,
  outcomeId?: string | null
) {
  if (isDatabaseConfigured()) {
    if (!market) {
      return [];
    }

    const cached = candleCache.get(
      buildCandleSeriesKey({
        symbol,
        market,
        interval,
        outcomeId: outcomeId ?? null,
      })
    );
    return cached?.slice(-limit) ?? [];
  }

  const store = readStore();
  return store.marketCandles
    .filter(
      (item) =>
        item.symbol.toUpperCase() === symbol.toUpperCase() &&
        item.interval === interval &&
        (!market || item.market === market) &&
        (outcomeId === undefined || (item.outcomeId ?? null) === (outcomeId ?? null))
    )
    .sort((a, b) => a.openTime.localeCompare(b.openTime))
    .slice(-limit)
    .map(
      (item): MarketCandleView => ({
        market: item.market,
        symbol: item.symbol,
        interval: item.interval,
        openTime: item.openTime,
        closeTime: item.closeTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        outcomeId: item.outcomeId,
      })
    );
}

export async function refreshMarketData(
  marketType: MarketType,
  symbols?: string[]
) {
  const liveResult = await refreshLiveMarketData(marketType, symbols);
  if (liveResult) {
    return liveResult;
  }

  if (isDatabaseConfigured()) {
    return {
      quotes: 0,
      candles: 0,
      errors: symbols?.filter(Boolean).length ?? 0,
      source: 'unavailable',
    };
  }

  return simulateMarketData(marketType, symbols);
}

export async function ensureMarketDataForSymbols(
  marketType: MarketType,
  symbols: string[],
  options?: { candlesInterval?: string; candlesLimit?: number }
) {
  const targetSymbols = [
    ...new Set(symbols.map((item) => normalizeRequestedSymbol(marketType, item)).filter(Boolean)),
  ];
  if (!targetSymbols.length) {
    return { quotes: 0, candles: 0, errors: 0, source: 'none' };
  }

  const liveResult = await refreshLiveMarketData(marketType, targetSymbols, options);
  if (liveResult) {
    return liveResult;
  }

  if (isDatabaseConfigured()) {
    return {
      quotes: 0,
      candles: 0,
      errors: targetSymbols.length,
      source: 'unavailable',
    };
  }

  const simResult = await simulateMarketData(marketType, targetSymbols);
  return simResult;
}

export async function getPredictionMarketDetails(symbol: string) {
  if (!isSimOnlyMode()) {
    const live = await fetchPolymarketMarketDetails(symbol);
    if (live) {
      await syncPredictionInstrument(live);
      const primaryOutcomeId =
        live.outcomes.find((item) => item.id)?.id ?? undefined;
      const cachedPrimaryQuote =
        getLatestQuote(live.symbol, 'prediction', primaryOutcomeId) ??
        getLatestQuote(live.symbol, 'prediction');
      if (!cachedPrimaryQuote) {
        const primaryOutcome =
          live.outcomes.find((item) => item.id === primaryOutcomeId) ??
          live.outcomes.find((item) => item.price != null) ??
          null;
        if (primaryOutcome?.price != null) {
          await saveQuoteSnapshots([
            {
              market: 'prediction',
              provider: 'polymarket',
              symbol: live.symbol,
              lastPrice: primaryOutcome.price,
              bid: null,
              ask: null,
              midpoint: primaryOutcome.price,
              spread: null,
              bidSize: null,
              askSize: null,
              volume24h: live.volume_24h ?? null,
              change24h: null,
              timestamp: new Date().toISOString(),
              outcomeId: primaryOutcome.id ?? null,
              outcomeName: primaryOutcome.name,
            },
          ]);
        }
      }
      return {
        ...live,
        quote:
          getLatestQuote(live.symbol, 'prediction', primaryOutcomeId) ??
          getLatestQuote(live.symbol, 'prediction'),
      } satisfies PredictionMarketDetails;
    }
  }

  if (isDatabaseConfigured()) {
    const databaseDetails = await getPredictionMarketDetailsFromDatabase(symbol);
    if (databaseDetails) {
      return databaseDetails;
    }
  }

  const local = findInstrument(symbol, 'prediction');

  if (!local) {
    return null;
  }

  return buildStoredPredictionDetails(local);
}

export async function getPredictionEventDetails(symbol: string) {
  if (isSimOnlyMode()) {
    return null;
  }

  return fetchPolymarketEventDetails(symbol);
}

export async function searchPredictionEvents(query: string, limit?: number) {
  if (isSimOnlyMode()) {
    return [] as PredictionEventDetails[];
  }

  return fetchPolymarketEventsByQuery(query, limit);
}
