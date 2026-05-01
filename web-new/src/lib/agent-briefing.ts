import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import {
  AGENT_SCHEMA_VERSION,
  buildProtocolMetadata,
} from '@/contracts/agent-protocol';
import { readStore } from '@/db/store';
import { buildAccountPerformanceMetrics, getRiskMode } from '@/lib/account-metrics';
import {
  getAgentCompetitionStatus,
  getAgentLeaderboardRank,
  getLatestLeaderboardSnapshot,
} from '@/lib/agent-competition';
import { refreshDisplayEquity } from '@/lib/display-equity';
import { envConfigs } from '@/lib/env';
import {
  ensureMarketDataForSymbols,
  getLatestQuote,
  getPredictionMarketDetails,
} from '@/lib/market-adapter';
import { getPlatformCompetition, PLATFORM_COMPETITION } from '@/lib/platform-context';
import { isUsStockMarketOpen } from '@/lib/risk-checks';
import { getBriefingWindowBounds } from '@/lib/trading-rules';
import { roundUsd, toIsoString } from '@/lib/utils';

function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent briefing');
  }
}

type BriefingPosition = {
  symbol: string;
  market_type: string;
  object_id: string | null;
  external_token_id: string | null;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
  qty: number;
  avg_price: number;
  market_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
  unrealized_pnl_rate: number;
};

type BriefingPredictionOutcome = {
  object_id: string;
  event_id: string;
  outcome_id: string | null;
  external_token_id: string | null;
  outcome_name: string;
  price: number | null;
  rule_allowed: boolean;
  quote_health: 'reliable' | 'incomplete' | 'unreliable' | 'unknown';
  detail_required_before_decision: boolean;
  requires_detail_for_execution_quality: boolean;
  execution_allowed: boolean;
  decision_allowed: boolean | null;
  decision_allowed_scope: 'execution_level' | 'rule_level_only' | 'blocked';
  blocked_reason: string | null;
};

type BriefingPredictionMarket = {
  object_id: string;
  symbol: string;
  title: string | null;
  end_date: string | null;
  active: boolean | null;
  closed: boolean | null;
  price: number | null;
  volume_24h: number | null;
  tradable_now: boolean;
  recommended_action: 'REVIEW_TRADABLE_OUTCOMES' | 'NO_TRADE';
  reason: string | null;
  outcomes: BriefingPredictionOutcome[];
};

type BriefingMarketSummary = {
  market_type: 'stock' | 'crypto' | 'prediction';
  status: string;
  source: string;
  summary: string;
  data_quality?: {
    change_24h_complete?: boolean;
    volume_24h_complete?: boolean;
    notes: string[];
  };
  top_movers?: Array<{
    symbol: string;
    price: number;
    change_24h: number | null;
    volume_24h: number | null;
  }>;
  active_markets?: number;
  tradable_now?: boolean;
  recommended_action?: string | null;
  reason?: string | null;
  featured_market?: BriefingPredictionMarket | null;
  top_markets?: BriefingPredictionMarket[];
};

type BriefingByMarket = Record<
  string,
  { positions: number; market_value: number; unrealized_pnl: number }
>;

type BriefingAgentSource = {
  id: string;
  name: string;
  description: string | null;
  primaryMarket: string | null;
  familiarSymbolsOrEventTypes: string[];
  strategyHint: string | null;
  riskPreference: string | null;
  marketPreferences: string[];
  claimStatus: string;
  status: string;
  runnerStatus: string;
};

type BriefingAccountSource = {
  initialCash: number;
  availableCash: number;
  totalEquity: number;
  displayEquity: number;
  riskTag: 'high_risk' | 'close_only' | 'terminated' | null;
};

function roundNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number.parseFloat(value.toFixed(digits));
}

function roundFraction(value: number) {
  return roundNumber(value, 4);
}

function parseDbStringArray(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function formatSignedPercent(decimalValue: number) {
  const percent = roundNumber(decimalValue * 100, 2);
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function normalizeOutcomeObjectKey(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function buildPredictionEventObjectId(symbol: string) {
  return `pm:${symbol}`;
}

function buildPredictionObjectId(symbol: string, outcomeName: string | null | undefined) {
  if (!outcomeName) {
    return null;
  }

  return `pm:${symbol}:${normalizeOutcomeObjectKey(outcomeName)}`;
}

function buildPositionObjectId(
  market: string,
  symbol: string,
  outcomeName: string | null | undefined
) {
  if (market === 'prediction') {
    return buildPredictionObjectId(symbol, outcomeName);
  }

  return symbol;
}

async function getPredictionOutcomeQuote(
  symbol: string,
  outcomeId?: string | null
) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const candidateKeys = [
      outcomeId ? `${symbol}::${outcomeId}` : null,
      symbol,
    ].filter((value): value is string => Boolean(value));

    for (const key of candidateKeys) {
      const rows = await sql<
        {
          last_price: number | null;
          bid: number | null;
          ask: number | null;
        }[]
      >`
        select
          last_price,
          bid,
          ask
        from market_data_snapshots
        where instrument_id = ${key}
        order by quote_ts desc
        limit 1
      `;
      const row = rows[0] ?? null;
      if (!row) {
        continue;
      }

      return {
        lastPrice: row.last_price,
        bid: row.bid,
        ask: row.ask,
      };
    }

    return null;
  }

  const quote = getLatestQuote(symbol, 'prediction', outcomeId ?? undefined) ?? null;
  if (!quote) {
    return null;
  }

  return {
    lastPrice: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
  };
}

function getPredictionQuoteHealth(input: {
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
}) {
  const { lastPrice, bid, ask } = input;
  if (lastPrice == null && bid == null && ask == null) {
    return 'unknown' as const;
  }

  if (bid == null || ask == null) {
    return 'incomplete' as const;
  }

  const spread = ask - bid;
  if (
    ask < bid ||
    (bid <= 0.02 && ask >= 0.98) ||
    spread >= 0.9 ||
    (lastPrice != null && (lastPrice < bid || lastPrice > ask))
  ) {
    return 'unreliable' as const;
  }

  return 'reliable' as const;
}

function buildBriefingAccountView(
  accountMetrics: ReturnType<typeof buildAccountPerformanceMetrics>,
  drawdown: number
) {
  const returnDecimal = roundFraction(accountMetrics.displayReturnRate / 100);
  const drawdownDecimal = roundFraction(drawdown / 100);

  return {
    cash: accountMetrics.availableCash,
    equity: accountMetrics.displayEquity,
    display_equity: accountMetrics.displayEquity,
    accounting_equity: accountMetrics.totalEquity,
    initial_cash: accountMetrics.initialCash,
    return_decimal: returnDecimal,
    return_display: formatSignedPercent(returnDecimal),
    drawdown_decimal: drawdownDecimal,
    drawdown_display: formatSignedPercent(drawdownDecimal),
    drawdown_basis: 'percentage_from_historical_peak_equity',
    risk_tag: accountMetrics.riskTag,
  };
}

async function buildBriefingPosition(position: {
  symbol: string;
  market: string;
  eventId: string | null;
  outcomeId: string | null;
  outcomeName: string | null;
  positionSize: number;
  entryPrice: number;
  marketPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
}) {
  let eventId = position.eventId;
  let outcomeId = position.outcomeId;
  let outcomeName = position.outcomeName;

  if (position.market === 'prediction') {
    eventId ??= position.symbol;

    if ((!outcomeId || !outcomeName) && position.symbol) {
      const marketDetails = await getPredictionMarketDetails(position.symbol).catch(() => null);

      if (!outcomeId && outcomeName) {
        outcomeId =
          marketDetails?.outcomes.find(
            (outcome) =>
              normalizeOutcomeObjectKey(outcome.name) ===
              normalizeOutcomeObjectKey(outcomeName ?? '')
          )?.id ?? null;
      }

      if (!outcomeName && outcomeId) {
        outcomeName =
          marketDetails?.outcomes.find((outcome) => outcome.id === outcomeId)?.name ?? null;
      }
    }
  }

  const unrealizedPnlRate =
    position.costBasis > 0 ? roundNumber((position.unrealizedPnl / position.costBasis) * 100, 4) : 0;

  return {
    symbol: position.symbol,
    market_type: position.market,
    object_id: buildPositionObjectId(position.market, position.symbol, outcomeName),
    external_token_id: outcomeId,
    event_id: eventId,
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    qty: position.positionSize,
    avg_price: position.entryPrice,
    market_price: position.marketPrice,
    market_value: position.marketValue,
    cost_basis: position.costBasis,
    unrealized_pnl: position.unrealizedPnl,
    unrealized_pnl_rate: unrealizedPnlRate,
  } satisfies BriefingPosition;
}

async function getLatestDrawdown(agentId: string) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const rows = await sql<{ drawdown: number | null }[]>`
      select drawdown
      from account_snapshots
      where agent_id = ${agentId}
      order by ts desc
      limit 1
    `;
    return rows[0]?.drawdown ?? 0;
  }

  const store = readStore();
  return (
    store.accountSnapshots
      .filter((item) => item.agentId === agentId)
      .sort((left, right) => right.ts.localeCompare(left.ts))[0]?.drawdown ?? 0
  );
}

async function getDecisionWindowState(agentId: string, openedAtIso: string, closesAtIso: string) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const [windowRows, latestRows] = await Promise.all([
      sql<{ total: number }[]>`
        select count(*)::int as total
        from decision_window_consumptions
        where agent_id = ${agentId}
          and consumed_at >= ${openedAtIso}
          and consumed_at < ${closesAtIso}
      `,
      sql<{ received_at: string | Date | null }[]>`
        select consumed_at as received_at
        from decision_window_consumptions
        where agent_id = ${agentId}
        order by consumed_at desc
        limit 1
      `,
    ]);

    return {
      usedInWindow: Number(windowRows[0]?.total ?? 0),
      lastDecisionAt: toIsoString(latestRows[0]?.received_at) ?? null,
    };
  }

  const store = readStore();
  const usedSubmissions = store.decisionSubmissions.filter(
    (item) =>
      item.agentId === agentId &&
      item.receivedAt >= openedAtIso &&
      item.receivedAt < closesAtIso
  );
  const latestDecisionAt =
    store.decisionSubmissions
      .filter((item) => item.agentId === agentId)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))[0]?.receivedAt ?? null;

  return {
    usedInWindow: usedSubmissions.length,
    lastDecisionAt: latestDecisionAt,
  };
}

async function collectCandidateSymbols(
  agent: Pick<BriefingAgentSource, 'familiarSymbolsOrEventTypes'>,
  market: 'stock' | 'crypto' | 'prediction'
) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const preferred = agent.familiarSymbolsOrEventTypes.filter((item) =>
      /^[A-Za-z0-9:_-]+$/.test(item)
    );
    const instrumentRows = await sql<{ symbol: string }[]>`
      select symbol
      from market_instruments
      where market = ${market}
      order by symbol asc
      limit ${market === 'prediction' ? 6 : 12}
    `;
    const instrumentSymbols = instrumentRows.map((item) => item.symbol);
    return [...new Set([...preferred, ...instrumentSymbols])].slice(
      0,
      market === 'prediction' ? 3 : 8
    );
  }

  const store = readStore();
  const preferred = agent.familiarSymbolsOrEventTypes.filter((item) => /^[A-Za-z0-9:_-]+$/.test(item));
  const instrumentSymbols = store.marketInstruments
    .filter((item) => item.market === market)
    .map((item) => item.symbol);

  return [...new Set([...preferred, ...instrumentSymbols])].slice(0, market === 'prediction' ? 3 : 8);
}

async function buildTopMovers(
  market: 'stock' | 'crypto',
  symbols: string[]
) {
  if (isDatabaseConfigured()) {
    const cachedRows = symbols
      .map((symbol) => getLatestQuote(symbol, market))
      .filter((quote): quote is NonNullable<ReturnType<typeof getLatestQuote>> => Boolean(quote))
      .sort(
        (left, right) =>
          Math.abs(right.change24h ?? 0) - Math.abs(left.change24h ?? 0)
      )
      .slice(0, 5)
      .map((quote) => ({
        symbol: quote.symbol,
        price: quote.lastPrice,
        change_24h: quote.change24h ?? null,
        volume_24h: quote.volume24h ?? null,
      }));
    if (cachedRows.length) {
      return cachedRows;
    }

    const sql = getSqlClient();
    const rows = await Promise.all(
      symbols.map(async (symbol) => {
        const quoteRows = await sql<
          {
            last_price: number | null;
          }[]
        >`
          select mds.last_price
          from market_data_snapshots mds
          left join market_instruments mi on mi.id = mds.instrument_id
          where (mi.symbol = ${symbol} and mi.market = ${market})
             or mds.instrument_id = ${symbol}
          order by mds.quote_ts desc
          limit 1
        `;
        const lastPrice = quoteRows[0]?.last_price ?? null;
        if (lastPrice == null) {
          return null;
        }

        return {
          symbol,
          price: lastPrice,
          change_24h: null,
          volume_24h: null,
        };
      })
    );

    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).slice(0, 5);
  }

  return symbols
    .map((symbol) => getLatestQuote(symbol, market))
    .filter((quote): quote is NonNullable<ReturnType<typeof getLatestQuote>> => Boolean(quote))
    .sort(
      (left, right) =>
        Math.abs(right.change24h ?? 0) - Math.abs(left.change24h ?? 0)
    )
    .slice(0, 5)
    .map((quote) => ({
      symbol: quote.symbol,
      price: quote.lastPrice,
      change_24h: quote.change24h,
      volume_24h: quote.volume24h,
    }));
}

async function buildSpotMarketSummary(
  market: 'stock' | 'crypto',
  symbols: string[]
): Promise<BriefingMarketSummary> {
  if (symbols.length) {
    await ensureMarketDataForSymbols(market, symbols, {
      candlesInterval: '1h',
      candlesLimit: 24,
    });
  }

  const topMovers = await buildTopMovers(market, symbols);
  const changeComplete = topMovers.every((item) => item.change_24h != null);
  const volumeComplete = topMovers.every((item) => item.volume_24h != null);
  const status =
    market === 'stock' ? (isUsStockMarketOpen() ? 'open' : 'closed') : 'open';
  const label = market === 'stock' ? 'Stock' : 'Crypto';

  return {
    market_type: market,
    status,
    source: topMovers.length ? 'cached_quotes' : 'unavailable',
    summary: topMovers.length
      ? `${label} watchlist has ${topMovers.length} recently priced instruments.`
      : `${label} market data is currently limited.`,
    data_quality: {
      change_24h_complete: changeComplete,
      volume_24h_complete: volumeComplete,
      notes: topMovers.length
        ? []
        : ['no_recent_quotes_available_for_watchlist'],
    },
    top_movers: topMovers,
  };
}

async function mapPredictionMarket(
  details: NonNullable<Awaited<ReturnType<typeof getPredictionMarketDetails>>>,
  heldOutcomeKeys: Set<string>
): Promise<BriefingPredictionMarket> {
  const ruleAllowed = !(
    details.closed === true ||
    details.active === false ||
    details.accepting_orders === false ||
    ['resolved', 'resolving'].includes(String(details.market_status ?? '').toLowerCase())
  );
  const pricedOutcomes = await Promise.all(details.outcomes.map(async (outcome) => ({
    object_id:
      buildPredictionObjectId(details.symbol, outcome.name) ??
      buildPredictionEventObjectId(details.symbol),
    event_id: details.symbol,
    outcome_id: outcome.id ?? null,
    external_token_id: outcome.id ?? null,
    outcome_name: outcome.name,
    ...(await (async () => {
      const quote = await getPredictionOutcomeQuote(details.symbol, outcome.id ?? undefined);
      const price = quote?.lastPrice ?? outcome.price ?? null;
      const quoteHealth = getPredictionQuoteHealth({
        lastPrice: price,
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
      });
      const hasPosition = heldOutcomeKeys.has(
        `${details.symbol}::${normalizeOutcomeObjectKey(outcome.name)}`
      );
      const extremeEntryBlocked = !hasPosition && price != null && price >= 0.98;
      const executionAllowed = ruleAllowed && quoteHealth === 'reliable' && !extremeEntryBlocked;
      const blockedReason = !ruleAllowed
        ? 'PREDICTION_MARKET_CLOSED'
        : extremeEntryBlocked
          ? 'EXTREME_PRICE_ENTRY_BLOCKED'
          : quoteHealth === 'incomplete'
            ? 'TOP_OF_BOOK_INCOMPLETE'
            : quoteHealth === 'unreliable'
              ? 'TOP_OF_BOOK_UNRELIABLE'
              : quoteHealth === 'unknown'
                ? 'DETAIL_REQUIRED'
                : null;

      return {
        price,
        rule_allowed: ruleAllowed,
        quote_health: quoteHealth,
        detail_required_before_decision: !executionAllowed,
        requires_detail_for_execution_quality: !executionAllowed,
        execution_allowed: executionAllowed,
        decision_allowed: executionAllowed,
        decision_allowed_scope: executionAllowed
          ? ('execution_level' as const)
          : ruleAllowed
            ? ('rule_level_only' as const)
            : ('blocked' as const),
        blocked_reason: blockedReason,
      };
    })()),
  })));
  const tradableNow = pricedOutcomes.some((outcome) => outcome.execution_allowed);

  return {
    object_id: buildPredictionEventObjectId(details.symbol),
    symbol: details.symbol,
    title: details.title ?? details.name ?? null,
    end_date: details.resolves_at ?? null,
    active: details.active ?? null,
    closed: details.closed ?? null,
    price:
      details.quote?.lastPrice ??
      pricedOutcomes.find((item) => item.price != null)?.price ??
      null,
    volume_24h: details.volume_24h ?? null,
    tradable_now: tradableNow,
    recommended_action: tradableNow ? 'REVIEW_TRADABLE_OUTCOMES' : 'NO_TRADE',
    reason: tradableNow
      ? null
      : pricedOutcomes.some((outcome) => outcome.blocked_reason === 'EXTREME_PRICE_ENTRY_BLOCKED')
        ? 'High-probability outcomes above 0.98 are blocked for fresh entries unless already held.'
        : 'Prediction outcomes are visible, but execution-quality checks remain conservative in briefing.',
    outcomes: pricedOutcomes,
  };
}

async function buildPredictionSummary(
  agent: Pick<BriefingAgentSource, 'familiarSymbolsOrEventTypes'>,
  predictionPositions: Array<{ symbol: string; outcome_name: string | null }>
) {
  const candidateSymbols = await collectCandidateSymbols(agent, 'prediction');
  if (candidateSymbols.length) {
    await ensureMarketDataForSymbols('prediction', candidateSymbols, {
      candlesInterval: '1h',
      candlesLimit: 24,
    });
  }
  const detailsList = (
    await Promise.all(candidateSymbols.map((symbol) => getPredictionMarketDetails(symbol).catch(() => null)))
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const heldOutcomeKeys = new Set(
    predictionPositions
      .filter((position) => position.outcome_name)
      .map(
        (position) =>
          `${position.symbol}::${normalizeOutcomeObjectKey(position.outcome_name ?? '')}`
      )
  );
  const topMarkets = await Promise.all(
    detailsList.slice(0, 3).map((item) => mapPredictionMarket(item, heldOutcomeKeys))
  );
  const featuredMarket = topMarkets[0] ?? null;
  const activeMarkets = detailsList.filter(
    (item) =>
      item.closed !== true &&
      item.active !== false &&
      item.accepting_orders !== false
  ).length;
  const tradableNow = topMarkets.some((market) => market.tradable_now);

  return {
    market_type: 'prediction' as const,
    status: activeMarkets > 0 ? 'open' : 'closed',
    source: topMarkets.length ? 'cached_markets' : 'unavailable',
    summary: topMarkets.length
      ? tradableNow
        ? `${topMarkets.length} prediction markets are highlighted for this agent, with execution-ready outcomes surfaced conservatively.`
        : `${topMarkets.length} prediction markets are highlighted, but none are execution-ready from briefing alone.`
      : 'Prediction market data is currently limited.',
    data_quality: {
      notes: topMarkets.length ? [] : ['no_prediction_market_details_available'],
    },
    active_markets: activeMarkets,
    tradable_now: tradableNow,
    recommended_action: tradableNow ? 'REVIEW_TRADABLE_OUTCOMES' : 'NO_TRADE',
    reason: tradableNow
      ? null
      : 'Use detail_request for prediction discovery. If outcome-level top-of-book is unreliable, treat that outcome as no-trade for the current window.',
    featured_market: featuredMarket,
    top_markets: topMarkets,
  } satisfies BriefingMarketSummary;
}

async function getRecentPublicTrades(limit = 5) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const rows = await sql<
      {
        agent_id: string;
        symbol: string;
        side: string;
        notional_usd: number | null;
        executed_at: string | Date | null;
        reason_tag: string | null;
      }[]
    >`
      select
        agent_id,
        symbol,
        side,
        notional_usd,
        executed_at,
        reason_tag
      from live_trade_events
      order by executed_at desc
      limit ${limit}
    `;

    return rows.map((trade) => ({
      agent_id: trade.agent_id,
      symbol: trade.symbol,
      side: trade.side.toLowerCase(),
      notional_usd: trade.notional_usd ?? 0,
      executed_at: toIsoString(trade.executed_at) ?? new Date().toISOString(),
      reason_tag: trade.reason_tag,
    }));
  }

  const store = readStore();
  return store.liveTradeEvents
    .slice()
    .sort((left, right) => right.executedAt.localeCompare(left.executedAt))
    .slice(0, limit)
    .map((trade) => ({
      agent_id: trade.agentId,
      symbol: trade.symbol,
      side: trade.side,
      notional_usd: trade.notionalUsd,
      executed_at: trade.executedAt,
      reason_tag: trade.reasonTag,
    }));
}

async function getWatchlistQuotes(
  agent: Pick<BriefingAgentSource, 'familiarSymbolsOrEventTypes' | 'primaryMarket'>
) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const preferredSymbols = agent.familiarSymbolsOrEventTypes.filter((item) =>
      /^[A-Za-z0-9_:-]+$/.test(item)
    );
    const primarySymbols = agent.primaryMarket
      ? (
          await sql<{ symbol: string }[]>`
            select symbol
            from market_instruments
            where market = ${agent.primaryMarket}
            order by symbol asc
            limit 8
          `
        ).map((row) => row.symbol)
      : [];
    const watchlist = Array.from(new Set([...preferredSymbols, ...primarySymbols])).slice(0, 5);
    if (
      watchlist.length &&
      (agent.primaryMarket === 'stock' ||
        agent.primaryMarket === 'crypto' ||
        agent.primaryMarket === 'prediction')
    ) {
      await ensureMarketDataForSymbols(agent.primaryMarket, watchlist, {
        candlesInterval: '1h',
        candlesLimit: 24,
      });
    }

    const quotes = await Promise.all(
      watchlist.map(async (symbol) => {
        const instrumentRows = await sql<{ id: string; market: string }[]>`
          select id, market
          from market_instruments
          where symbol = ${symbol}
          limit 1
        `;
        const cachedMarket = instrumentRows[0]?.market as 'stock' | 'crypto' | 'prediction' | undefined;
        const cachedQuote = cachedMarket ? getLatestQuote(symbol, cachedMarket) : null;
        if (cachedQuote?.lastPrice != null) {
          return {
            symbol,
            market: cachedQuote.market,
            lastPrice: cachedQuote.lastPrice,
            change24h: cachedQuote.change24h ?? null,
          };
        }

        const quoteRows = await sql<{ last_price: number | null }[]>`
          select mds.last_price
          from market_data_snapshots mds
          left join market_instruments mi on mi.id = mds.instrument_id
          where (mi.symbol = ${symbol} and mi.market = ${instrumentRows[0]?.market ?? ''})
             or mds.instrument_id = ${symbol}
             or mds.instrument_id = ${instrumentRows[0]?.id ?? ''}
          order by quote_ts desc
          limit 1
        `;
        const market = instrumentRows[0]?.market ?? null;
        const lastPrice = quoteRows[0]?.last_price ?? null;
        if (!market || lastPrice == null) {
          return null;
        }

        return {
          symbol,
          market,
          lastPrice,
          change24h: null,
        };
      })
    );

    return quotes.filter((quote): quote is NonNullable<typeof quote> => Boolean(quote));
  }

  const store = readStore();
  return Array.from(
    new Set([
      ...agent.familiarSymbolsOrEventTypes.filter((item) => /^[A-Za-z0-9_:-]+$/.test(item)),
      ...(agent.primaryMarket
        ? store.marketInstruments
            .filter((item) => item.market === agent.primaryMarket)
            .map((item) => item.symbol)
        : []),
    ])
  )
    .slice(0, 5)
    .map((symbol) => getLatestQuote(symbol))
    .filter((quote): quote is NonNullable<ReturnType<typeof getLatestQuote>> => Boolean(quote));
}

export async function buildAgentBriefing(
  agentId: string,
  now = new Date(),
  status: string | null = null
) {
  requireDatabaseMode();
  let agent: BriefingAgentSource | null = null;
  let account: BriefingAccountSource | null = null;

  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const [agentRows, accountRows] = await Promise.all([
      sql<
        {
          id: string;
          name: string;
          description: string | null;
          primary_market: string | null;
          familiar_symbols_or_event_types: string | null;
          strategy_hint: string | null;
          risk_preference: string | null;
          market_preferences: string | null;
          claim_status: string | null;
          status: string;
          runner_status: string | null;
        }[]
      >`
        select
          id,
          name,
          description,
          primary_market,
          familiar_symbols_or_event_types,
          strategy_hint,
          risk_preference,
          market_preferences,
          claim_status,
          status,
          runner_status
        from agents
        where id = ${agentId}
        limit 1
      `,
      sql<
        {
          initial_cash: number | null;
          available_cash: number | null;
          total_equity: number | null;
          display_equity: number | null;
          risk_tag: 'high_risk' | 'close_only' | 'terminated' | null;
        }[]
      >`
        select
          initial_cash,
          available_cash,
          total_equity,
          display_equity,
          risk_tag
        from agent_accounts
        where agent_id = ${agentId}
        limit 1
      `,
    ]);
    const agentRow = agentRows[0] ?? null;
    const accountRow = accountRows[0] ?? null;

    agent = agentRow
      ? {
          id: agentRow.id,
          name: agentRow.name,
          description: agentRow.description,
          primaryMarket: agentRow.primary_market,
          familiarSymbolsOrEventTypes: parseDbStringArray(
            agentRow.familiar_symbols_or_event_types
          ),
          strategyHint: agentRow.strategy_hint,
          riskPreference: agentRow.risk_preference,
          marketPreferences: parseDbStringArray(agentRow.market_preferences),
          claimStatus: agentRow.claim_status ?? 'unclaimed',
          status: agentRow.status,
          runnerStatus: agentRow.runner_status ?? 'idle',
        }
      : null;
    account = accountRow
      ? {
          initialCash: accountRow.initial_cash ?? 0,
          availableCash: accountRow.available_cash ?? 0,
          totalEquity: accountRow.total_equity ?? 0,
          displayEquity: accountRow.display_equity ?? accountRow.total_equity ?? 0,
          riskTag: accountRow.risk_tag,
        }
      : null;
  } else {
    const store = readStore();
    agent = store.agents.find((item) => item.id === agentId) ?? null;
    account = store.agentAccounts.find((item) => item.agentId === agentId) ?? null;
  }

  const competition = await getPlatformCompetition();
  const latestRank = await getAgentLeaderboardRank(agentId);
  const leaderboard = await getLatestLeaderboardSnapshot();
  const marked = await refreshDisplayEquity(agentId);
  const recentPublicTrades = await getRecentPublicTrades(5);

  if (!agent || !account) {
    return null;
  }

  const window = getBriefingWindowBounds(now);
  const drawdown = await getLatestDrawdown(agentId);
  const competitionStatus = await getAgentCompetitionStatus(agentId, agent.claimStatus);
  const metrics = buildAccountPerformanceMetrics({
    initialCash: account.initialCash,
    availableCash: account.availableCash,
    totalEquity: account.totalEquity,
    displayEquity: marked.displayEquity,
    riskTag: account.riskTag,
  });
  const normalizedPositions = await Promise.all(
    marked.markedPositions.map((position) =>
      buildBriefingPosition({
        symbol: position.symbol,
        market: position.market,
        eventId: position.eventId,
        outcomeId: position.outcomeId,
        outcomeName: position.outcomeName,
        positionSize: position.positionSize,
        entryPrice: position.entryPrice,
        marketPrice: position.marketPrice,
        marketValue: position.marketValue,
        costBasis: roundUsd(position.positionSize * position.entryPrice),
        unrealizedPnl: position.unrealizedPnl,
      })
    )
  );
  const { usedInWindow, lastDecisionAt } = await getDecisionWindowState(
    agentId,
    window.openedAt.toISOString(),
    window.closesAt.toISOString()
  );
  const grossMarketValue = normalizedPositions.reduce(
    (sum, position) => sum + position.market_value,
    0
  );
  const unrealizedPnl = normalizedPositions.reduce(
    (sum, position) => sum + position.unrealized_pnl,
    0
  );
  const largestPosition = normalizedPositions.reduce<BriefingPosition | null>(
    (largest, position) =>
      !largest || position.market_value > largest.market_value ? position : largest,
    null
  );
  const byMarket = normalizedPositions.reduce((acc, position) => {
    const current = acc[position.market_type] ?? {
      positions: 0,
      market_value: 0,
      unrealized_pnl: 0,
    };

    current.positions += 1;
    current.market_value = roundNumber(current.market_value + position.market_value);
    current.unrealized_pnl = roundNumber(current.unrealized_pnl + position.unrealized_pnl);
    acc[position.market_type] = current;
    return acc;
  }, {} as BriefingByMarket);
  const currentRiskMode = getRiskMode({
    riskTag: metrics.riskTag,
    cash: account.availableCash,
    equity: marked.displayEquity,
  });
  const pausedByOperator = (status ?? agent.status) === 'paused';
  const decisionWindowUsed = usedInWindow >= 1;
  const canTrade =
    currentRiskMode !== 'terminated' && !decisionWindowUsed && !pausedByOperator;
  const canOpenNewPositions = canTrade && currentRiskMode !== 'close_only';
  const riskConstraints = [
    currentRiskMode === 'terminated'
      ? 'Equity is zero or the account is marked terminated.'
      : null,
    currentRiskMode === 'close_only'
      ? 'Cash is below $100, so buys are blocked and every sell must only reduce or close an existing position.'
      : null,
    currentRiskMode === 'high_risk'
      ? 'Equity is below $5,000, so the account is in high-risk mode.'
      : null,
    pausedByOperator
      ? 'The operator has paused new decisions for this agent. Observe briefing state but do not submit a decision until resumed.'
      : null,
    decisionWindowUsed
      ? 'The current briefing window already has a submitted decision.'
      : null,
  ].filter((item): item is string => Boolean(item));
  const stockSymbols = await collectCandidateSymbols(agent, 'stock');
  const cryptoSymbols = await collectCandidateSymbols(agent, 'crypto');
  const stockSummary = await buildSpotMarketSummary('stock', stockSymbols);
  const cryptoSummary = await buildSpotMarketSummary('crypto', cryptoSymbols);
  const predictionSummary = await buildPredictionSummary(
    agent,
    normalizedPositions
      .filter((position) => position.market_type === 'prediction')
      .map((position) => ({
        symbol: position.symbol,
        outcome_name: position.outcome_name,
      }))
  );
  const marketHighlights = [
    `Crypto: ${cryptoSummary.summary}`,
    `Prediction: ${predictionSummary.summary}`,
    `Stock: ${stockSummary.summary}`,
  ];
  const briefingAccountView = buildBriefingAccountView(metrics, drawdown);
  const watchlistQuotes = await getWatchlistQuotes(agent);

  return {
    ...buildProtocolMetadata(AGENT_SCHEMA_VERSION.briefingResponse, now),
    timestamp: now.toISOString(),
    current_time: now.toISOString(),
    agent_profile: {
      agent_id: agent.id,
      name: agent.name,
      public_profile_summary: agent.description ?? null,
      primary_market: agent.primaryMarket ?? null,
      familiar_symbols_or_event_types: agent.familiarSymbolsOrEventTypes,
      strategy_style: agent.strategyHint ?? null,
      risk_preference: agent.riskPreference ?? null,
      market_preferences: agent.marketPreferences,
    },
    public_profile_summary: agent.description ?? null,
    account_summary: briefingAccountView,
    positions_summary: {
      total_positions: normalizedPositions.length,
      gross_market_value: roundNumber(grossMarketValue),
      unrealized_pnl: roundNumber(unrealizedPnl),
      largest_position: largestPosition,
      by_market: byMarket,
    },
    risk_status: {
      current_mode: currentRiskMode,
      risk_tag: metrics.riskTag,
      paused_by_operator: pausedByOperator,
      awaiting_operator_resolution: pausedByOperator,
      can_trade: canTrade,
      decision_allowed: canTrade,
      can_open_new_positions: canOpenNewPositions,
      max_single_buy_notional: roundUsd(marked.displayEquity * 0.25),
      sizing_equity: roundUsd(marked.displayEquity),
      decision_window: {
        id: window.id,
        used: usedInWindow,
        limit: 1,
        reached: decisionWindowUsed,
        last_decision_at: lastDecisionAt,
      },
      constraints: riskConstraints,
      summary:
        riskConstraints[0] ??
        'Account is clear to review markets and trade within standard limits.',
    },
    market_signal_summary: {
      highlights: marketHighlights,
      actionable_markets: [stockSummary, cryptoSummary, predictionSummary]
        .filter(
          (market) =>
            market.status === 'open' &&
            (market.market_type !== 'prediction' || market.tradable_now !== false)
        )
        .map((market) => market.market_type),
      crypto: {
        status: cryptoSummary.status,
        summary: cryptoSummary.summary,
      },
      prediction: {
        status: predictionSummary.status,
        summary: predictionSummary.summary,
        active_markets: predictionSummary.active_markets ?? 0,
        tradable_now: predictionSummary.tradable_now ?? false,
        recommended_action: predictionSummary.recommended_action ?? null,
        reason: predictionSummary.reason ?? null,
        featured_market: predictionSummary.featured_market ?? null,
        top_markets: predictionSummary.top_markets ?? [],
      },
      stock: {
        status: stockSummary.status,
        summary: stockSummary.summary,
      },
    },
    account: {
      ...briefingAccountView,
      positions: normalizedPositions.map((position) => ({
        symbol: position.symbol,
        market_type: position.market_type,
        object_id: position.object_id,
        external_token_id: position.external_token_id,
        event_id: position.event_id,
        outcome_id: position.outcome_id,
        outcome_name: position.outcome_name,
        qty: position.qty,
        avg_price: position.avg_price,
        market_price: position.market_price,
      })),
    },
    markets: {
      stock: stockSummary,
      crypto: cryptoSummary,
      prediction: predictionSummary,
    },
    competition_phase: competitionStatus.competition_phase,
    leaderboard_visibility_status:
      competitionStatus.leaderboard_visibility_status,
    required_executed_actions_for_visibility:
      competitionStatus.required_executed_actions_for_visibility,
    executed_action_count: competitionStatus.executed_action_count,
    competition: {
      ...PLATFORM_COMPETITION,
      ...(competition
        ? {
            id: competition.id,
            name: competition.name,
            status: competition.status,
            description: competition.description,
            rule_version: competition.ruleVersion,
            market_types: competition.marketTypes,
            start_at: competition.startAt,
            end_at: competition.endAt,
            created_at: competition.createdAt,
            leaderboard_visibility: competition.leaderboard_visibility,
          }
        : {}),
      ...competitionStatus,
    },

    // Compatibility extras kept for the rebuilt local console.
    type: 'agent_briefing',
    window_id: window.id,
    agent: {
      id: agent.id,
      name: agent.name,
      status: status ?? agent.status,
      runner_status: agent.runnerStatus,
      primary_market: agent.primaryMarket,
      strategy_style: agent.strategyHint,
      risk_preference: agent.riskPreference,
    },
    open_positions: marked.markedPositions.map((item) => ({
      symbol: item.symbol,
      market: item.market,
      event_id: item.eventId,
      outcome_id: item.outcomeId,
      outcome_name: item.outcomeName,
      qty: item.positionSize,
      avg_price: item.entryPrice,
      market_price: item.marketPrice,
      unrealized_pnl: item.unrealizedPnl,
    })),
    market_overview: {
      watchlist: watchlistQuotes.map((quote) => ({
        symbol: quote.symbol,
        market: quote.market,
        last_price: quote.lastPrice,
        change_24h: quote.change24h,
      })),
      headline: `${leaderboard.length} agents are active in the current arena.`,
      recent_public_trades: recentPublicTrades,
    },
    leaderboard: latestRank
      ? {
          rank: latestRank.rank,
          total_agents: leaderboard.length,
          return_rate: latestRank.returnRate,
          drawdown: latestRank.drawdown,
          top_tier: latestRank.topTier,
        }
      : null,
    endpoints: {
      skill_url: `${envConfigs.appUrl.replace(/\/$/, '')}/skill.md`,
      briefing_url: `${envConfigs.appUrl.replace(/\/$/, '')}/api/agent/briefing`,
      detail_request_url: `${envConfigs.appUrl.replace(/\/$/, '')}/api/agent/detail-request`,
      decisions_url: `${envConfigs.appUrl.replace(/\/$/, '')}/api/agent/decisions`,
    },
  };
}
