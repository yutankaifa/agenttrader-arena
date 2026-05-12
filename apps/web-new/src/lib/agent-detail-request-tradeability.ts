import type { MarketType } from 'agenttrader-types';
import {
  type MarketCandleView,
  type MarketQuote,
} from '@/lib/market-adapter';
import {
  normalizeOutcomeObjectKey,
} from '@/lib/agent-runtime-service-common';
import {
  type DetailDecisionContext,
  type NormalizedDetailObject,
  type PredictionEventDetailsView,
  type PredictionMarketDetailsView,
  buildObjectRisk,
  buildPredictionObjectId,
  findObjectPosition,
  normalizeLookupKey,
} from '@/lib/agent-detail-request-objects';
import {
  type DetailQuoteResult,
  buildSyntheticPredictionOutcomeQuote,
} from '@/lib/agent-detail-request-market-data';
import {
  isUsStockMarketOpen,
} from '@/lib/risk-checks';
import {
  MIN_CASH_FOR_NEW_BUYS,
} from '@/lib/trading-rules';
import { roundUsd } from '@/lib/utils';

const DETAIL_QUOTE_STALE_MS: Record<MarketType, number> = {
  stock: 120_000,
  crypto: 60_000,
  prediction: 30_000,
};

function extractPredictionBookDebug(depthSnapshot: string | null | undefined) {
  if (!depthSnapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(depthSnapshot) as Record<string, unknown>;
    const rawDebug =
      parsed.book_debug && typeof parsed.book_debug === 'object'
        ? (parsed.book_debug as Record<string, unknown>)
        : null;
    if (!rawDebug) {
      return null;
    }

    return {
      direct:
        rawDebug.direct && typeof rawDebug.direct === 'object'
          ? rawDebug.direct
          : null,
      complement:
        rawDebug.complement && typeof rawDebug.complement === 'object'
          ? rawDebug.complement
          : null,
      complement_outcome_name:
        typeof rawDebug.complement_outcome_name === 'string'
          ? rawDebug.complement_outcome_name
          : null,
      synthetic:
        rawDebug.synthetic && typeof rawDebug.synthetic === 'object'
          ? rawDebug.synthetic
          : null,
    };
  } catch {
    return null;
  }
}

function getPredictionQuoteDepthSnapshot(
  quote:
    | (MarketQuote & { depthSnapshot?: string | null })
    | { depthSnapshot?: string | null }
    | null
    | undefined
) {
  if (!quote || typeof quote !== 'object' || !('depthSnapshot' in quote)) {
    return null;
  }

  return quote.depthSnapshot ?? null;
}

function buildQuoteFreshness(market: MarketType, timestamp: string | null | undefined) {
  if (!timestamp) {
    return {
      quote_timestamp: null,
      cache_age_ms: null,
      stale: null,
    };
  }

  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return {
      quote_timestamp: timestamp,
      cache_age_ms: null,
      stale: null,
    };
  }

  const cacheAgeMs = Math.max(0, Date.now() - parsedTimestamp);
  return {
    quote_timestamp: timestamp,
    cache_age_ms: cacheAgeMs,
    stale: cacheAgeMs > DETAIL_QUOTE_STALE_MS[market],
  };
}

function resolveQuotedOutcome(input: {
  object: NormalizedDetailObject;
  quote: MarketQuote | null;
  marketDetails: PredictionMarketDetailsView | null;
}) {
  const { object, quote, marketDetails } = input;
  if (!quote || !marketDetails?.outcomes?.length) return null;

  const preferredOutcomeKey = object.outcomeKey
    ? normalizeOutcomeObjectKey(object.outcomeKey)
    : null;
  if (preferredOutcomeKey) {
    const matchedOutcome =
      marketDetails.outcomes.find(
        (outcome) => normalizeOutcomeObjectKey(outcome.name) === preferredOutcomeKey
      ) ?? null;
    if (matchedOutcome) return matchedOutcome;
  }

  if (quote.outcomeId) {
    const matchedOutcome =
      marketDetails.outcomes.find((outcome) => outcome.id === quote.outcomeId) ?? null;
    if (matchedOutcome) return matchedOutcome;
  }

  if (quote.outcomeName) {
    const matchedOutcome =
      marketDetails.outcomes.find(
        (outcome) =>
          normalizeOutcomeObjectKey(outcome.name) === normalizeOutcomeObjectKey(quote.outcomeName ?? '')
      ) ?? null;
    if (matchedOutcome) return matchedOutcome;
  }

  return marketDetails.outcomes[0] ?? null;
}

function isLastPriceMateriallyOutsideTopOfBook(
  market: MarketType,
  lastPrice: number,
  bid: number,
  ask: number,
  spread: number | null
) {
  if (lastPrice >= bid && lastPrice <= ask) {
    return false;
  }

  if (market === 'prediction') {
    return true;
  }

  const deviation = lastPrice < bid ? bid - lastPrice : lastPrice - ask;
  const relativeTolerance = Math.max(Math.abs(lastPrice) * 0.0005, 0.05);
  const spreadTolerance = spread != null ? Math.max(spread * 2, 0.05) : 0.05;
  return deviation > Math.max(relativeTolerance, spreadTolerance);
}

function getQuoteWarnings(
  market: MarketType,
  quote: MarketQuote,
  candles: MarketCandleView[]
) {
  const warnings: string[] = [];
  const bid = quote.bid;
  const ask = quote.ask;
  const spread =
    quote.spread ?? (bid != null && ask != null ? Math.max(0, ask - bid) : null);

  if (bid != null && ask != null) {
    if (ask < bid) {
      warnings.push('top_of_book_crossed');
    }
    if (
      isLastPriceMateriallyOutsideTopOfBook(
        market,
        quote.lastPrice,
        bid,
        ask,
        spread
      )
    ) {
      warnings.push('last_price_outside_top_of_book');
    }
  }

  if (market === 'prediction' && (bid == null || ask == null)) {
    warnings.push('top_of_book_incomplete');
  }

  if (
    market === 'prediction' &&
    bid != null &&
    ask != null &&
    ((bid <= 0.02 && ask >= 0.98) || (spread != null && spread >= 0.9))
  ) {
    warnings.push('top_of_book_unreliable');
  }

  const latestCandle = candles[candles.length - 1];
  if (
    market === 'prediction' &&
    latestCandle &&
    Math.abs(quote.lastPrice - latestCandle.close) >= 0.2
  ) {
    warnings.push('quote_candle_mismatch');
  }

  return warnings;
}

function isBlockingTradeabilityWarning(market: MarketType, warning: string) {
  if (['top_of_book_crossed', 'last_price_outside_top_of_book'].includes(warning)) {
    return true;
  }

  if (market !== 'prediction') {
    return false;
  }

  return [
    'top_of_book_incomplete',
    'top_of_book_unreliable',
    'quote_candle_mismatch',
  ].includes(warning);
}

export function collectDetailWarnings(input: {
  market: MarketType;
  quote: MarketQuote | null;
  candles: MarketCandleView[];
  marketDetails: PredictionMarketDetailsView | null;
  quoteError: string | null;
  candlesError: string | null;
}) {
  const warnings: string[] = [];

  if (!input.quote) {
    warnings.push(
      input.quoteError ? `quote_unavailable:${input.quoteError}` : 'quote_unavailable'
    );
  } else {
    warnings.push(...getQuoteWarnings(input.market, input.quote, input.candles));
  }

  if (!input.candles.length) {
    warnings.push(
      input.candlesError
        ? `candles_unavailable:${input.candlesError}`
        : 'candles_unavailable'
    );
  }

  if (input.market === 'prediction' && !input.marketDetails) {
    warnings.push('market_details_unavailable');
  }

  return [...new Set(warnings)];
}

function normalizeBlockedReason(value: string | null) {
  if (!value) return null;
  return value
    .replace(/^quote_unavailable:/, '')
    .replace(/^candles_unavailable:/, '')
    .trim()
    .toUpperCase();
}

function deriveMarketBlockedReason(
  market: MarketType,
  marketDetails: PredictionMarketDetailsView | null
) {
  if (market === 'stock' && !isUsStockMarketOpen()) {
    return 'MARKET_CLOSED';
  }

  if (market !== 'prediction' || !marketDetails) {
    return null;
  }

  if (
    marketDetails.closed === true ||
    marketDetails.active === false ||
    marketDetails.accepting_orders === false
  ) {
    return 'PREDICTION_MARKET_CLOSED';
  }

  const marketStatus = String(marketDetails.market_status ?? '').toLowerCase();
  if (['resolving', 'resolved'].includes(marketStatus)) {
    return 'PREDICTION_MARKET_CLOSED';
  }

  return null;
}

function derivePredictionOutcomeQuoteBlockedReason(
  quote: MarketQuote | null
) {
  if (!quote) {
    return 'QUOTE_UNAVAILABLE';
  }

  const freshness = buildQuoteFreshness('prediction', quote.timestamp);
  if (freshness.stale) {
    return 'QUOTE_STALE';
  }

  const warnings = getQuoteWarnings('prediction', quote, []);
  const blockingWarning = warnings.find((warning) =>
    isBlockingTradeabilityWarning('prediction', warning)
  );
  return blockingWarning ? normalizeBlockedReason(blockingWarning) : null;
}

export function deriveUnavailableReason(input: {
  market: MarketType;
  object: NormalizedDetailObject;
  quote: MarketQuote | null;
  candles: MarketCandleView[];
  eventDetails: PredictionEventDetailsView | null;
  marketDetails: PredictionMarketDetailsView | null;
  warnings: string[];
}) {
  const { market, object, quote, candles, eventDetails, marketDetails, warnings } = input;

  if (
    market === 'prediction' &&
    !object.outcomeKey &&
    ((eventDetails?.markets?.length ?? 0) > 0 || (marketDetails?.outcomes?.length ?? 0) > 0)
  ) {
    return null;
  }

  if (!quote) {
    if (market === 'prediction' && !eventDetails && !marketDetails) {
      if (object.requestedScope === 'search') {
        return 'no_prediction_market_match';
      }

      if (object.requestedScope === 'market') {
        return 'prediction_market_not_found';
      }

      if (object.requestedScope === 'token') {
        return 'prediction_token_not_found';
      }

      return 'prediction_event_not_found';
    }

    return warnings.find((warning) => warning.startsWith('quote_unavailable')) ?? 'quote_unavailable';
  }

  if (!candles.length) {
    return (
      warnings.find((warning) => warning.startsWith('candles_unavailable')) ??
      'candles_unavailable'
    );
  }

  if (market === 'prediction' && !marketDetails) {
    return 'market_details_unavailable';
  }

  return warnings.find((warning) => isBlockingTradeabilityWarning(market, warning)) ?? null;
}

export function buildQuoteView(input: {
  market: MarketType;
  quote: MarketQuote | null;
  quoteSource: string;
  candles: MarketCandleView[];
  object: NormalizedDetailObject;
  marketDetails: PredictionMarketDetailsView | null;
}) {
  const { quote, quoteSource, market, candles, object, marketDetails } = input;
  if (!quote) {
    return { quote: null, depth: null };
  }

  const quotedOutcome =
    market === 'prediction'
      ? resolveQuotedOutcome({
          object,
          quote,
          marketDetails,
        })
      : null;
  const outcomeName = quotedOutcome?.name ?? quote.outcomeName ?? null;
  const outcomeId = quotedOutcome?.id ?? quote.outcomeId ?? null;
  const predictionObjectId =
    market === 'prediction'
      ? outcomeName && object.eventId
        ? buildPredictionObjectId(object.eventId, outcomeName)
        : object.eventId
          ? `pm:${object.eventId}`
          : object.objectId
      : object.objectId;
  const freshness = buildQuoteFreshness(market, quote.timestamp);

  const quoteView = {
    object_id: predictionObjectId,
    canonical_object_id: predictionObjectId,
    external_token_id: outcomeId,
    outcome_id: outcomeId,
    outcome_name: outcomeName,
    scope: market === 'prediction' && (outcomeId || outcomeName) ? ('outcome' as const) : undefined,
    last_price: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
    midpoint: quote.midpoint,
    spread: quote.spread,
    bid_size: quote.bidSize,
    ask_size: quote.askSize,
    volume_24h: quote.volume24h,
    change_24h: quote.change24h,
    timestamp: quote.timestamp,
    source: quoteSource,
    ...freshness,
  };

  const quoteWarnings = getQuoteWarnings(market, quote, candles);
  const unreliableDepth = quoteWarnings.some((warning) =>
    [
      'top_of_book_unreliable',
      'top_of_book_crossed',
      'top_of_book_incomplete',
      'last_price_outside_top_of_book',
      'quote_candle_mismatch',
    ].includes(warning)
  );

  return {
    quote: quoteView,
    depth: unreliableDepth
      ? null
      : {
          best_bid: quote.bid ?? quote.lastPrice,
          best_ask: quote.ask ?? quote.lastPrice,
          spread: quote.spread ?? null,
          bid_size: quote.bidSize ?? null,
          ask_size: quote.askSize ?? null,
          note: 'Depth is approximated from top-of-book data when top-of-book passes sanity checks',
        },
  };
}

export function buildDetailDataQuality(input: {
  market: MarketType;
  item: NormalizedDetailObject;
  quoteView: ReturnType<typeof buildQuoteView>;
  candles: MarketCandleView[];
  warnings: string[];
}) {
  const { market, item, quoteView, candles, warnings } = input;
  const notes: string[] = [];
  const quoteBoundToOutcome =
    market === 'prediction'
      ? Boolean(quoteView.quote?.outcome_id || item.outcomeKey)
      : undefined;
  const hasCandles = candles.length > 0;
  const candlesHaveVolume = candles.some((candle) => candle.volume != null);
  const quoteChange24hComplete = quoteView.quote?.change_24h != null;
  const quoteVolume24hComplete = quoteView.quote?.volume_24h != null;

  if (market === 'prediction' && !quoteBoundToOutcome) {
    notes.push('quote_is_event_level_context_use_tradable_objects_for_outcome_selection');
  }
  if (!quoteChange24hComplete) {
    notes.push('quote_change_24h_missing');
  }
  if (!quoteVolume24hComplete) {
    notes.push('quote_volume_24h_missing');
  }
  if (!hasCandles) {
    notes.push('candles_unavailable_limits_technical_analysis');
  } else if (!candlesHaveVolume) {
    notes.push('candles_volume_missing_from_upstream_data');
  }
  if (warnings.length) {
    notes.push('see_warnings_for_market_quality_flags');
  }

  return {
    quote_bound_to_outcome: quoteBoundToOutcome,
    candles_have_volume: candlesHaveVolume,
    warnings_present: warnings.length > 0,
    quote_change_24h_complete: quoteChange24hComplete,
    quote_volume_24h_complete: quoteVolume24hComplete,
    notes,
  };
}

export function deriveDetailTradePolicy(input: {
  object: NormalizedDetailObject;
  decisionContext: DetailDecisionContext;
  eventDetails: PredictionEventDetailsView | null;
  marketDetails: PredictionMarketDetailsView | null;
  objectRisk: ReturnType<typeof buildObjectRisk>;
  unavailableReason: string | null;
  quoteAvailable: boolean;
}) {
  const { object, decisionContext, eventDetails, marketDetails, objectRisk, unavailableReason, quoteAvailable } = input;
  const matchedPosition = findObjectPosition(object, decisionContext.positions);
  const hasPosition = (matchedPosition?.positionSize ?? 0) > 0;

  if (object.market === 'prediction' && !object.outcomeKey) {
    const hasPredictionChoices =
      (eventDetails?.markets?.length ?? 0) > 0 || (marketDetails?.outcomes?.length ?? 0) > 0;
    const blockedReason = hasPredictionChoices
      ? 'SELECT_TRADABLE_OUTCOME_REQUIRED'
      : object.requestedScope === 'search'
        ? 'NO_PREDICTION_MARKET_MATCH'
        : object.requestedScope === 'market'
          ? 'PREDICTION_MARKET_NOT_FOUND'
          : object.requestedScope === 'token'
            ? 'PREDICTION_TOKEN_NOT_FOUND'
            : 'PREDICTION_EVENT_NOT_FOUND';
    return {
      tradable: false,
      decision_allowed: false,
      allowed_actions: [] as Array<'buy' | 'sell'>,
      blocked_reason: blockedReason,
    };
  }

  const marketTradable =
    quoteAvailable &&
    !unavailableReason &&
    !deriveMarketBlockedReason(object.market, marketDetails);
  if (!marketTradable) {
    return {
      tradable: false,
      decision_allowed: false,
      allowed_actions: [] as Array<'buy' | 'sell'>,
      blocked_reason: normalizeBlockedReason(
        unavailableReason ?? deriveMarketBlockedReason(object.market, marketDetails)
      ),
    };
  }

  if (decisionContext.riskTag === 'terminated') {
    return {
      tradable: true,
      decision_allowed: false,
      allowed_actions: [] as Array<'buy' | 'sell'>,
      blocked_reason: 'AGENT_TERMINATED',
    };
  }

  if (decisionContext.pausedByOperator) {
    return {
      tradable: true,
      decision_allowed: false,
      allowed_actions: [] as Array<'buy' | 'sell'>,
      blocked_reason: 'PAUSED_BY_OPERATOR',
    };
  }

  if (
    decisionContext.riskTag === 'close_only' ||
    decisionContext.availableCash < MIN_CASH_FOR_NEW_BUYS
  ) {
    return {
      tradable: true,
      decision_allowed: hasPosition,
      allowed_actions: hasPosition ? ['sell'] : [],
      blocked_reason: hasPosition ? null : 'CLOSE_ONLY_MODE',
    };
  }

  const allowedActions: Array<'buy' | 'sell'> = [];
  if (objectRisk.can_add_exposure) {
    allowedActions.push('buy');
  }
  if (hasPosition) {
    allowedActions.push('sell');
  }

  return {
    tradable: true,
    decision_allowed: allowedActions.length > 0,
    allowed_actions: allowedActions,
    blocked_reason: allowedActions.length > 0 ? null : 'POSITION_CONCENTRATION_LIMIT',
  };
}

type PredictionTradableObjectCandidate = {
  object_id: string;
  market_slug: string;
  question: string | null;
  external_token_id: string | null;
  event_id: string;
  outcome_id: string | null;
  outcome_name: string;
  condition_id: string | null;
  quote: {
    last_price: number | null;
    bid: number | null;
    ask: number | null;
    midpoint: number | null;
    spread: number | null;
    timestamp: string | null;
    source: string;
    quote_timestamp: string | null;
    cache_age_ms: number | null;
    stale: boolean | null;
  } | null;
  book_debug?: {
    direct: unknown;
    complement: unknown;
    complement_outcome_name: string | null;
    synthetic: unknown;
  } | null;
  last_price: number | null;
  tradable: boolean;
  decision_allowed: boolean;
  allowed_actions: Array<'buy' | 'sell'>;
  blocked_reason: string | null;
};

function hasExecutionQualityPredictionQuote(
  quoteResult: DetailQuoteResult | null | undefined
) {
  if (!quoteResult?.quote) {
    return false;
  }

  return quoteResult.source !== 'market_details';
}

export function buildTradableObjects(
  object: NormalizedDetailObject,
  eventDetails: PredictionEventDetailsView | null,
  marketDetails: PredictionMarketDetailsView | null,
  decisionContext: DetailDecisionContext,
  predictionOutcomeQuoteContext?: Map<string, DetailQuoteResult>
) {
  const candidateMarkets =
    object.market !== 'prediction'
      ? []
      : marketDetails
        ? [marketDetails]
        : (eventDetails?.markets ?? []).slice(0, 8);
  if (!candidateMarkets.length) {
    return undefined;
  }

  return candidateMarkets.flatMap<PredictionTradableObjectCandidate>((candidateMarket) =>
    candidateMarket.outcomes.map((outcome) => {
      const eventId = eventDetails?.slug ?? object.eventId ?? candidateMarket.symbol;
      const outcomeObject: NormalizedDetailObject = {
        objectId: buildPredictionObjectId(candidateMarket.symbol, outcome.name),
        requestedObjectId: object.requestedObjectId,
        market: 'prediction',
        symbol: candidateMarket.symbol,
        eventId,
        outcomeKey: normalizeOutcomeObjectKey(outcome.name),
        requestedScope: 'outcome',
        predictionLookupKind: 'canonical_outcome',
        predictionSearchQuery: null,
        predictionTokenId: outcome.id ?? null,
      };
      const outcomeQuoteResult = outcome.id
        ? predictionOutcomeQuoteContext?.get(
            normalizeLookupKey(`${candidateMarket.symbol}::${outcome.id}`)
          ) ?? null
        : null;
      const fallbackOutcomeQuote =
        !outcomeQuoteResult?.quote && outcome.price != null
          ? buildSyntheticPredictionOutcomeQuote(candidateMarket, outcome)
          : null;
      const outcomeQuote = outcomeQuoteResult?.quote ?? fallbackOutcomeQuote;
      const quoteFreshness = buildQuoteFreshness(
        'prediction',
        outcomeQuote?.timestamp ?? null
      );
      const bookDebug = extractPredictionBookDebug(
        getPredictionQuoteDepthSnapshot(outcomeQuote)
      );
      const objectRisk = buildObjectRisk(outcomeObject, decisionContext);
      const hasExecutionQualityQuote = hasExecutionQualityPredictionQuote(
        outcomeQuoteResult
      );
      const unavailableReason = hasExecutionQualityQuote
        ? derivePredictionOutcomeQuoteBlockedReason(outcomeQuote)
        : 'QUOTE_UNAVAILABLE';
      const tradePolicy = deriveDetailTradePolicy({
        object: outcomeObject,
        decisionContext,
        eventDetails,
        marketDetails: candidateMarket,
        objectRisk,
        unavailableReason,
        quoteAvailable: hasExecutionQualityQuote,
      });

      return {
        object_id: outcomeObject.objectId,
        market_slug: candidateMarket.symbol,
        question: candidateMarket.title ?? candidateMarket.name ?? null,
        external_token_id: outcome.id ?? null,
        event_id: eventId,
        outcome_id: outcome.id ?? null,
        outcome_name: outcome.name,
        condition_id: candidateMarket.condition_id ?? null,
        quote: outcomeQuote
          ? {
              last_price: outcomeQuote.lastPrice,
              bid: outcomeQuote.bid,
              ask: outcomeQuote.ask,
              midpoint: outcomeQuote.midpoint,
              spread: outcomeQuote.spread,
              timestamp: outcomeQuote.timestamp,
              source: outcomeQuoteResult?.source ?? (fallbackOutcomeQuote ? 'market_details' : 'unavailable'),
              ...quoteFreshness,
            }
          : null,
        book_debug: bookDebug,
        last_price: outcomeQuote?.lastPrice ?? outcome.price ?? null,
        tradable: tradePolicy.tradable,
        decision_allowed: tradePolicy.decision_allowed,
        allowed_actions: tradePolicy.allowed_actions as Array<'buy' | 'sell'>,
        blocked_reason: tradePolicy.blocked_reason,
      };
    })
  );
}
