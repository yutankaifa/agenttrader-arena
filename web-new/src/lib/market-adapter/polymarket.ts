import type {
  MarketAdapter,
  MarketCandleView,
  PredictionEventDetails,
  MarketQuote,
  PredictionMarketDetails,
  PredictionSeriesSummary,
} from '@/lib/market-adapter/types';

const GAMMA_URL = 'https://gamma-api.polymarket.com';
const CLOB_URL = 'https://clob.polymarket.com';
const PRICE_HISTORY_FIDELITY_MINUTES = 60;

type PriceHistoryPoint = {
  t: number;
  p: number;
};

type ParsedClobBook = {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
};

async function gammaFetch(path: string) {
  const response = await fetch(`${GAMMA_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 30 },
  });
  if (!response.ok) {
    throw new Error(`Gamma API error: ${response.status}`);
  }
  return response.json();
}

async function clobFetch(path: string) {
  const response = await fetch(`${CLOB_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 10 },
  });
  if (!response.ok) {
    throw new Error(`CLOB API error: ${response.status}`);
  }
  return response.json();
}

function parseClobTokenIds(raw: string | null | undefined) {
  if (!raw) return [] as string[];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function parseJsonArray(raw: string | null | undefined) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseNumeric(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizePolymarketSlug(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function extractPolymarketEventSlug(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(
    /^https?:\/\/(?:www\.)?polymarket\.com\/event\/([^/?#]+)(?:[/?#].*)?$/i
  );
  if (urlMatch?.[1]) {
    return normalizePolymarketSlug(decodeURIComponent(urlMatch[1]));
  }

  return null;
}

function extractPolymarketMarketSlug(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(
    /^https?:\/\/(?:www\.)?polymarket\.com\/market\/([^/?#]+)(?:[/?#].*)?$/i
  );
  if (urlMatch?.[1]) {
    return normalizePolymarketSlug(decodeURIComponent(urlMatch[1]));
  }

  return null;
}

function buildPredictionMarketDetailsFromRaw(
  rawMarket: Record<string, unknown>,
  fallbackSymbol: string
): PredictionMarketDetails {
  const outcomeNames = parseJsonArray(
    typeof rawMarket.outcomes === 'string' ? rawMarket.outcomes : null
  );
  const outcomePrices = parseJsonArray(
    typeof rawMarket.outcomePrices === 'string' ? rawMarket.outcomePrices : null
  ).map((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const tokenIds = parseClobTokenIds(
    typeof rawMarket.clobTokenIds === 'string' ? rawMarket.clobTokenIds : null
  );
  const canonicalSymbol =
    typeof rawMarket.slug === 'string'
      ? rawMarket.slug
      : typeof rawMarket.conditionId === 'string'
        ? rawMarket.conditionId
        : fallbackSymbol;

  return {
    symbol: canonicalSymbol,
    name:
      typeof rawMarket.question === 'string'
        ? rawMarket.question
        : typeof rawMarket.title === 'string'
          ? rawMarket.title
          : canonicalSymbol,
    title:
      typeof rawMarket.question === 'string'
        ? rawMarket.question
        : typeof rawMarket.title === 'string'
          ? rawMarket.title
          : null,
    description:
      typeof rawMarket.description === 'string'
        ? rawMarket.description
        : typeof rawMarket.rules === 'string'
          ? rawMarket.rules
          : null,
    event_title:
      rawMarket.event && typeof rawMarket.event === 'object' && 'title' in rawMarket.event
        ? String((rawMarket.event as Record<string, unknown>).title)
        : null,
    category: typeof rawMarket.category === 'string' ? rawMarket.category : null,
    active: typeof rawMarket.active === 'boolean' ? rawMarket.active : null,
    closed: typeof rawMarket.closed === 'boolean' ? rawMarket.closed : null,
    archived: typeof rawMarket.archived === 'boolean' ? rawMarket.archived : null,
    accepting_orders:
      typeof rawMarket.acceptingOrders === 'boolean'
        ? rawMarket.acceptingOrders
        : null,
    market_status: typeof rawMarket.status === 'string' ? rawMarket.status : null,
    resolves_at:
      typeof rawMarket.endDate === 'string'
        ? rawMarket.endDate
        : typeof rawMarket.end_date === 'string'
          ? rawMarket.end_date
          : typeof rawMarket.end_time_iso === 'string'
            ? rawMarket.end_time_iso
            : typeof rawMarket.umaEndDate === 'string'
              ? rawMarket.umaEndDate
              : null,
    resolved_outcome_id: null,
    rules: typeof rawMarket.rules === 'string' ? rawMarket.rules : null,
    resolution_source:
      typeof rawMarket.resolutionSource === 'string'
        ? rawMarket.resolutionSource
        : typeof rawMarket.resolution_source === 'string'
          ? rawMarket.resolution_source
          : typeof rawMarket.oracleDescription === 'string'
            ? rawMarket.oracleDescription
            : null,
    volume_24h: parseNumeric(rawMarket.volume24hr),
    liquidity: parseNumeric(rawMarket.liquidity) ?? parseNumeric(rawMarket.liquidityClob),
    outcomes: outcomeNames.map((name, index) => ({
      id: tokenIds[index] ?? null,
      name,
      price: outcomePrices[index] ?? null,
    })),
    condition_id:
      typeof rawMarket.conditionId === 'string' ? rawMarket.conditionId : null,
    clob_token_ids: tokenIds,
    quote: null,
  } satisfies PredictionMarketDetails;
}

function buildSeriesSummary(rawSeries: unknown): PredictionSeriesSummary | null {
  if (!rawSeries || typeof rawSeries !== 'object') {
    return null;
  }

  const series = rawSeries as Record<string, unknown>;
  return {
    id: typeof series.id === 'string' ? series.id : null,
    slug: typeof series.slug === 'string' ? series.slug : null,
    title: typeof series.title === 'string' ? series.title : null,
    recurrence: typeof series.recurrence === 'string' ? series.recurrence : null,
    series_type: typeof series.seriesType === 'string' ? series.seriesType : null,
  };
}

async function getTokenPriceHistory(tokenId: string) {
  if (!tokenId) {
    return [] as PriceHistoryPoint[];
  }

  const data = await clobFetch(
    `/prices-history?market=${tokenId}&interval=1d&fidelity=${PRICE_HISTORY_FIDELITY_MINUTES}`
  );
  return Array.isArray(data?.history) ? (data.history as PriceHistoryPoint[]) : [];
}

function computeChange24h(history: PriceHistoryPoint[], currentPrice: number) {
  if (!history.length || !Number.isFinite(currentPrice)) {
    return null;
  }

  const normalized = history
    .map((point) => ({
      t: Number(point.t),
      p: Number(point.p),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p))
    .sort((left, right) => left.t - right.t);

  const baseline = normalized[0]?.p;
  if (!Number.isFinite(baseline) || baseline === 0) {
    return null;
  }

  return ((currentPrice - baseline) / baseline) * 100;
}

function parseTopLevelBookNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseBookLevel(
  level: unknown
): { price: number | null; size: number | null } | null {
  if (!level || typeof level !== 'object') {
    return null;
  }

  const record = level as Record<string, unknown>;
  return {
    price: parseTopLevelBookNumber(record.price),
    size: parseTopLevelBookNumber(record.size ?? record.qty),
  };
}

function parseClobBook(payload: unknown): ParsedClobBook {
  if (!payload || typeof payload !== 'object') {
    return {
      bid: null,
      ask: null,
      bidSize: null,
      askSize: null,
    };
  }

  const record = payload as Record<string, unknown>;
  const bestBid = Array.isArray(record.bids) ? parseBookLevel(record.bids[0]) : null;
  const bestAsk = Array.isArray(record.asks) ? parseBookLevel(record.asks[0]) : null;

  return {
    bid: bestBid?.price ?? null,
    ask: bestAsk?.price ?? null,
    bidSize: bestBid?.size ?? null,
    askSize: bestAsk?.size ?? null,
  };
}

function getBinaryComplementOutcome(
  market: PredictionMarketDetails,
  outcomeId: string | null | undefined
) {
  if (!outcomeId || market.outcomes.length !== 2) {
    return null;
  }

  return market.outcomes.find((candidate) => candidate.id && candidate.id !== outcomeId) ?? null;
}

function normalizeDerivedProbability(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0.001, Math.min(0.999, value));
}

export function combineBinaryOutcomeBooks(
  directBook: ParsedClobBook,
  complementBook: ParsedClobBook | null
) {
  const syntheticBid =
    complementBook?.ask != null
      ? normalizeDerivedProbability(1 - complementBook.ask)
      : null;
  const syntheticAsk =
    complementBook?.bid != null
      ? normalizeDerivedProbability(1 - complementBook.bid)
      : null;

  const bidCandidates = [
    {
      price: directBook.bid,
      size: directBook.bidSize,
    },
    {
      price: syntheticBid,
      size: complementBook?.askSize ?? null,
    },
  ].filter(
    (candidate): candidate is { price: number; size: number | null } =>
      candidate.price != null
  );
  const askCandidates = [
    {
      price: directBook.ask,
      size: directBook.askSize,
    },
    {
      price: syntheticAsk,
      size: complementBook?.bidSize ?? null,
    },
  ].filter(
    (candidate): candidate is { price: number; size: number | null } =>
      candidate.price != null
  );

  const bestBid = bidCandidates.sort((left, right) => right.price - left.price)[0] ?? null;
  const bestAsk = askCandidates.sort((left, right) => left.price - right.price)[0] ?? null;

  return {
    bid: bestBid?.price ?? null,
    ask: bestAsk?.price ?? null,
    bidSize: bestBid?.size ?? null,
    askSize: bestAsk?.size ?? null,
  };
}

function parseOutcomeSymbol(symbol: string) {
  const [eventSymbol, outcomeTokenId] = symbol.split('::');
  return {
    eventSymbol,
    outcomeTokenId: outcomeTokenId || null,
  };
}

export async function getPolymarketMarketDetails(
  symbol: string
): Promise<PredictionMarketDetails | null> {
  try {
    const { eventSymbol } = parseOutcomeSymbol(symbol);
    const isConditionId = eventSymbol.startsWith('0x');
    const queryParam = isConditionId
      ? `conditionId=${eventSymbol}`
      : `slug=${eventSymbol}`;
    const markets = await gammaFetch(`/markets?${queryParam}&limit=1`);

    if (!Array.isArray(markets) || !markets.length) {
      return null;
    }

    const market = markets[0] as Record<string, unknown>;
    return buildPredictionMarketDetailsFromRaw(market, eventSymbol);
  } catch (error) {
    console.error(`[polymarket] getMarketDetails(${symbol}) error:`, error);
    return null;
  }
}

export async function searchPolymarketEvents(
  query: string,
  limit = 3
): Promise<PredictionEventDetails[]> {
  try {
    const url = `/public-search?q=${encodeURIComponent(query)}&limit=${Math.max(limit, 1)}`;
    const data = (await gammaFetch(url)) as {
      events?: unknown[];
      markets?: unknown[];
    };
    const events = Array.isArray(data?.events) ? data.events : [];
    const markets = Array.isArray(data?.markets) ? data.markets : [];

    const eventResults = events
      .map((event) => buildPredictionEventDetailsFromRaw(event))
      .filter((event): event is PredictionEventDetails => Boolean(event));
    const marketResults = markets
      .map((market) => buildPredictionEventDetailsFromMarketSearchResult(market))
      .filter((event): event is PredictionEventDetails => Boolean(event));

    return [...new Map(
      [...eventResults, ...marketResults].map((event) => [event.slug, event] as const)
    ).values()].slice(0, limit);
  } catch (error) {
    console.error(`[polymarket] searchEvents(${query}) error:`, error);
    return [];
  }
}

function buildPredictionEventDetailsFromMarketSearchResult(
  rawMarket: unknown
): PredictionEventDetails | null {
  if (!rawMarket || typeof rawMarket !== 'object') {
    return null;
  }

  const market = rawMarket as Record<string, unknown>;
  const embeddedEvent =
    market.event && typeof market.event === 'object'
      ? (market.event as Record<string, unknown>)
      : null;
  const marketSlug =
    typeof market.slug === 'string' ? normalizePolymarketSlug(market.slug) : null;
  const eventSlug =
    embeddedEvent && typeof embeddedEvent.slug === 'string'
      ? normalizePolymarketSlug(embeddedEvent.slug)
      : null;
  const canonicalSlug = eventSlug ?? marketSlug;
  if (!canonicalSlug) {
    return null;
  }

  const marketDetails = buildPredictionMarketDetailsFromRaw(market, canonicalSlug);

  return {
    id:
      embeddedEvent && typeof embeddedEvent.id === 'string'
        ? embeddedEvent.id
        : typeof market.id === 'string'
          ? market.id
          : null,
    slug: canonicalSlug,
    title:
      embeddedEvent && typeof embeddedEvent.title === 'string'
        ? embeddedEvent.title
        : typeof market.question === 'string'
          ? market.question
          : typeof market.title === 'string'
            ? market.title
            : canonicalSlug,
    subtitle:
      embeddedEvent && typeof embeddedEvent.subtitle === 'string'
        ? embeddedEvent.subtitle
        : null,
    description:
      embeddedEvent && typeof embeddedEvent.description === 'string'
        ? embeddedEvent.description
        : typeof market.description === 'string'
          ? market.description
          : null,
    resolution_source:
      embeddedEvent && typeof embeddedEvent.resolutionSource === 'string'
        ? embeddedEvent.resolutionSource
        : typeof market.resolutionSource === 'string'
          ? market.resolutionSource
          : null,
    start_date:
      embeddedEvent && typeof embeddedEvent.startDate === 'string'
        ? embeddedEvent.startDate
        : null,
    end_date:
      embeddedEvent && typeof embeddedEvent.endDate === 'string'
        ? embeddedEvent.endDate
        : typeof market.endDate === 'string'
          ? market.endDate
          : null,
    active:
      embeddedEvent && typeof embeddedEvent.active === 'boolean'
        ? embeddedEvent.active
        : typeof market.active === 'boolean'
          ? market.active
          : null,
    closed:
      embeddedEvent && typeof embeddedEvent.closed === 'boolean'
        ? embeddedEvent.closed
        : typeof market.closed === 'boolean'
          ? market.closed
          : null,
    category:
      embeddedEvent && typeof embeddedEvent.category === 'string'
        ? embeddedEvent.category
        : typeof market.category === 'string'
          ? market.category
          : null,
    subcategory:
      embeddedEvent && typeof embeddedEvent.subcategory === 'string'
        ? embeddedEvent.subcategory
        : null,
    volume_24h:
      (embeddedEvent ? parseNumeric(embeddedEvent.volume24hr) : null) ??
      parseNumeric(market.volume24hr),
    volume:
      (embeddedEvent ? parseNumeric(embeddedEvent.volume) : null) ??
      parseNumeric(market.volume),
    liquidity:
      (embeddedEvent ? parseNumeric(embeddedEvent.liquidity) : null) ??
      parseNumeric(market.liquidity),
    open_interest:
      embeddedEvent ? parseNumeric(embeddedEvent.openInterest) : null,
    series_slug:
      embeddedEvent && typeof embeddedEvent.seriesSlug === 'string'
        ? embeddedEvent.seriesSlug
        : null,
    series: embeddedEvent && Array.isArray(embeddedEvent.series)
      ? embeddedEvent.series
          .map((item) => buildSeriesSummary(item))
          .filter((item): item is PredictionSeriesSummary => Boolean(item))
      : [],
    markets: [marketDetails],
  };
}

function buildPredictionEventDetailsFromRaw(
  rawEvent: unknown
): PredictionEventDetails | null {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const event = rawEvent as Record<string, unknown>;
  const slug = typeof event.slug === 'string' ? normalizePolymarketSlug(event.slug) : null;
  if (!slug) {
    return null;
  }

  const rawMarkets = Array.isArray(event.markets) ? event.markets : [];
  const markets = rawMarkets
    .map((market) =>
      market && typeof market === 'object'
        ? buildPredictionMarketDetailsFromRaw(market as Record<string, unknown>, slug)
        : null
    )
    .filter((market): market is PredictionMarketDetails => Boolean(market));

  const series = Array.isArray(event.series)
    ? event.series
        .map((item) => buildSeriesSummary(item))
        .filter((item): item is PredictionSeriesSummary => Boolean(item))
    : [];

  return {
    id: typeof event.id === 'string' ? event.id : null,
    slug,
    title: typeof event.title === 'string' ? event.title : null,
    subtitle: typeof event.subtitle === 'string' ? event.subtitle : null,
    description: typeof event.description === 'string' ? event.description : null,
    resolution_source:
      typeof event.resolutionSource === 'string' ? event.resolutionSource : null,
    start_date: typeof event.startDate === 'string' ? event.startDate : null,
    end_date: typeof event.endDate === 'string' ? event.endDate : null,
    active: typeof event.active === 'boolean' ? event.active : null,
    closed: typeof event.closed === 'boolean' ? event.closed : null,
    category: typeof event.category === 'string' ? event.category : null,
    subcategory: typeof event.subcategory === 'string' ? event.subcategory : null,
    volume_24h: parseNumeric(event.volume24hr),
    volume: parseNumeric(event.volume),
    liquidity: parseNumeric(event.liquidity),
    open_interest: parseNumeric(event.openInterest),
    series_slug: typeof event.seriesSlug === 'string' ? event.seriesSlug : null,
    series,
    markets,
  };
}

export async function getPolymarketEventDetails(
  input: string
): Promise<PredictionEventDetails | null> {
  const extractedSlug = extractPolymarketEventSlug(input);
  const extractedMarketSlug = extractPolymarketMarketSlug(input);

  if (extractedMarketSlug) {
    return null;
  }

  const slug = extractedSlug ?? normalizePolymarketSlug(input);
  if (!slug) {
    return null;
  }

  try {
    const event = await gammaFetch(`/events/slug/${encodeURIComponent(slug)}`);
    return buildPredictionEventDetailsFromRaw(event);
  } catch (error) {
    console.error(`[polymarket] getEventDetails(${input}) error:`, error);
    return null;
  }
}

async function buildOutcomeQuote(
  eventSymbol: string,
  market: PredictionMarketDetails,
  outcome: { id: string | null; name: string; price: number | null }
) {
  const currentPrice = outcome.price ?? 0.5;
  let bid: number | null = null;
  let ask: number | null = null;
  let bidSize: number | null = null;
  let askSize: number | null = null;
  let change24h: number | null = null;

  if (outcome.id) {
    const complementOutcome = getBinaryComplementOutcome(market, outcome.id);
    const [bookResult, complementBookResult, historyResult] = await Promise.allSettled([
      clobFetch(`/book?token_id=${outcome.id}`),
      complementOutcome?.id
        ? clobFetch(`/book?token_id=${complementOutcome.id}`)
        : Promise.resolve(null),
      getTokenPriceHistory(outcome.id),
    ]);

    if (
      bookResult.status === 'fulfilled' ||
      complementBookResult.status === 'fulfilled'
    ) {
      const directBook =
        bookResult.status === 'fulfilled'
          ? parseClobBook(bookResult.value)
          : {
              bid: null,
              ask: null,
              bidSize: null,
              askSize: null,
            };
      const complementBook =
        complementBookResult.status === 'fulfilled'
          ? parseClobBook(complementBookResult.value)
          : null;
      const combinedBook = combineBinaryOutcomeBooks(directBook, complementBook);
      bid = combinedBook.bid;
      ask = combinedBook.ask;
      bidSize = combinedBook.bidSize;
      askSize = combinedBook.askSize;
    }

    if (historyResult.status === 'fulfilled') {
      change24h = computeChange24h(historyResult.value, currentPrice);
    }
  }

  return {
    market: 'prediction' as const,
    provider: 'polymarket',
    symbol: eventSymbol,
    lastPrice: currentPrice,
    bid,
    ask,
    midpoint: bid != null && ask != null ? (bid + ask) / 2 : currentPrice,
    spread: bid != null && ask != null ? ask - bid : null,
    bidSize,
    askSize,
    volume24h: market.volume_24h ?? null,
    change24h,
    timestamp: new Date().toISOString(),
    outcomeId: outcome.id,
    outcomeName: outcome.name,
  } satisfies MarketQuote;
}

export const polymarketAdapter: MarketAdapter = {
  name: 'polymarket',
  market: 'prediction',

  async getQuote(symbol: string): Promise<MarketQuote | null> {
    try {
      const { eventSymbol, outcomeTokenId } = parseOutcomeSymbol(symbol);
      const details = await getPolymarketMarketDetails(eventSymbol);
      if (!details) {
        return null;
      }

      const outcome =
        details.outcomes.find((item) => item.id === outcomeTokenId) ??
        details.outcomes[0] ??
        null;
      if (!outcome) {
        return null;
      }

      return await buildOutcomeQuote(details.symbol, details, outcome);
    } catch (error) {
      console.error(`[polymarket] getQuote(${symbol}) error:`, error);
      return null;
    }
  },

  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    const quoteGroups = await Promise.all(
      symbols.map(async (symbol) => {
        const details = await getPolymarketMarketDetails(symbol);
        if (!details) {
          return [] as MarketQuote[];
        }

        const quotes = await Promise.all(
          details.outcomes
            .filter((outcome) => Boolean(outcome.id) || outcome.price != null)
            .map((outcome) => buildOutcomeQuote(details.symbol, details, outcome))
        );

        return quotes;
      })
    );

    return quoteGroups.flat();
  },

  async getCandles(
    symbol: string,
    interval: string,
    limit = 100
  ): Promise<MarketCandleView[]> {
    try {
      const { eventSymbol, outcomeTokenId } = parseOutcomeSymbol(symbol);
      const details = await getPolymarketMarketDetails(eventSymbol);
      if (!details) {
        return [];
      }

      const tokenId =
        outcomeTokenId ??
        details.outcomes.find((outcome) => Boolean(outcome.id))?.id ??
        null;
      if (!tokenId) {
        return [];
      }

      const fidelityMap: Record<string, number> = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '1h': 60,
        '1d': 1440,
      };
      const fidelity = fidelityMap[interval] || 60;
      const data = await clobFetch(
        `/prices-history?market=${tokenId}&interval=${interval === '1d' ? 'max' : 'all'}&fidelity=${fidelity}`
      );

      const history = Array.isArray(data?.history) ? data.history : [];
      const outcomeName =
        details.outcomes.find((outcome) => outcome.id === tokenId)?.name ?? null;

      return history.slice(-limit).map(
        (point: { t: number; p: number }): MarketCandleView => ({
          market: 'prediction',
          provider: 'polymarket',
          symbol: details.symbol,
          interval,
          openTime: new Date(point.t * 1000).toISOString(),
          closeTime: new Date(point.t * 1000).toISOString(),
          open: Number.parseFloat(String(point.p)),
          high: Number.parseFloat(String(point.p)),
          low: Number.parseFloat(String(point.p)),
          close: Number.parseFloat(String(point.p)),
          volume: null,
          outcomeId: tokenId,
          outcomeName,
        })
      );
    } catch (error) {
      console.error(`[polymarket] getCandles(${symbol}) error:`, error);
      return [];
    }
  },

  async getTopSymbols(limit = 20): Promise<string[]> {
    try {
      const markets = await gammaFetch(
        `/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=${limit}`
      );

      return Array.isArray(markets)
        ? markets
            .map((item: Record<string, unknown>) =>
              typeof item.slug === 'string' ? item.slug : null
            )
            .filter((item): item is string => Boolean(item))
        : [];
    } catch (error) {
      console.error('[polymarket] getTopSymbols error:', error);
      return [];
    }
  },
};
