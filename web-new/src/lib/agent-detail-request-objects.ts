import type { MarketType } from '@/db/schema';
export type {
  PredictionEventDetails as PredictionEventDetailsView,
  PredictionMarketDetails as PredictionMarketDetailsView,
} from '@/lib/market-adapter/types';
import {
  normalizeOutcomeObjectKey,
} from '@/lib/agent-runtime-service-common';
import { buildPredictionSearchQuery } from '@/lib/prediction-search';
import { roundUsd } from '@/lib/utils';

export type DetailRequestScope =
  | 'auto'
  | 'search'
  | 'event'
  | 'market'
  | 'outcome'
  | 'token';

export type PredictionLookupKind =
  | 'canonical_event'
  | 'canonical_outcome'
  | 'event_url'
  | 'market_url'
  | 'market_slug'
  | 'search'
  | 'token';

export type DetailObjectScope =
  | 'instrument'
  | 'search'
  | 'event'
  | 'market'
  | 'outcome'
  | 'token';

type DetailPositionSnapshot = {
  market: MarketType;
  symbol: string;
  eventId: string | null;
  outcomeId: string | null;
  outcomeName: string | null;
  positionSize: number;
  marketPrice: number | null;
  entryPrice: number;
};

export type NormalizedDetailObject = {
  objectId: string;
  requestedObjectId: string;
  market: MarketType;
  symbol: string;
  eventId: string | null;
  outcomeKey: string | null;
  requestedScope: DetailRequestScope;
  predictionLookupKind: PredictionLookupKind | null;
  predictionSearchQuery: string | null;
  predictionTokenId: string | null;
};

export type DetailDecisionContext = {
  status: string | null;
  pausedByOperator: boolean;
  riskTag: string | null;
  totalEquity: number;
  availableCash: number;
  canOpenNewPositions: boolean;
  positions: DetailPositionSnapshot[];
};

function inferMarketFromObjectId(objectId: string): MarketType {
  const trimmed = objectId.trim();
  if (/^https?:\/\/(?:www\.)?polymarket\.com\/(?:event|market)\//i.test(trimmed)) {
    return 'prediction';
  }
  if (trimmed.startsWith('eq:')) return 'stock';
  if (trimmed.startsWith('crypto:')) return 'crypto';
  if (trimmed.startsWith('pm:') || trimmed.startsWith('pm_event:')) return 'prediction';
  if (/^[A-Z]{2,10}(-USD)?$/i.test(trimmed)) {
    const normalized = trimmed.replace(/-USD$/i, '').toUpperCase();
    if (['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA'].includes(normalized)) {
      return 'crypto';
    }
    return 'stock';
  }
  return 'prediction';
}

export function normalizeDetailMarketHint(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stock' || normalized === 'crypto' || normalized === 'prediction') {
    return normalized as MarketType;
  }

  return null;
}

export function normalizeDetailScope(value: unknown) {
  if (typeof value !== 'string') return 'auto' as const;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'auto' ||
    normalized === 'search' ||
    normalized === 'event' ||
    normalized === 'market' ||
    normalized === 'outcome' ||
    normalized === 'token'
  ) {
    return normalized as DetailRequestScope;
  }

  return null;
}

function normalizeSpotSymbol(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('eq:')) return trimmed.slice(3).trim().toUpperCase();
  if (trimmed.startsWith('crypto:')) {
    return trimmed.slice(7).trim().replace(/-USD$/i, '').toUpperCase();
  }
  return trimmed.replace(/-USD$/i, '').toUpperCase();
}

export function buildPredictionObjectId(symbol: string, outcomeName: string) {
  return `pm:${symbol}:${normalizeOutcomeObjectKey(outcomeName)}`;
}

function extractPolymarketEventSlug(input: string) {
  const match = input.trim().match(
    /^https?:\/\/(?:www\.)?polymarket\.com\/event\/([^/?#]+)(?:[/?#].*)?$/i
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function extractPolymarketMarketSlug(input: string) {
  const match = input.trim().match(
    /^https?:\/\/(?:www\.)?polymarket\.com\/market\/([^/?#]+)(?:[/?#].*)?$/i
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function normalizePredictionDetailObjectId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const eventSlugFromUrl = extractPolymarketEventSlug(trimmed);
  if (eventSlugFromUrl) {
    return {
      objectId: `pm:${eventSlugFromUrl}`,
      eventId: eventSlugFromUrl,
      outcomeKey: null,
      requestedScope: 'event' as const,
      predictionLookupKind: 'event_url' as const,
      predictionSearchQuery: null,
      predictionTokenId: null,
      symbol: eventSlugFromUrl,
    };
  }

  const marketSlugFromUrl = extractPolymarketMarketSlug(trimmed);
  if (marketSlugFromUrl) {
    return {
      objectId: `pm:${marketSlugFromUrl}`,
      eventId: marketSlugFromUrl,
      outcomeKey: null,
      requestedScope: 'market' as const,
      predictionLookupKind: 'market_url' as const,
      predictionSearchQuery: null,
      predictionTokenId: null,
      symbol: marketSlugFromUrl,
    };
  }

  if (/^\d{10,}$/.test(trimmed)) {
    return {
      objectId: `pm_token:${trimmed}`,
      eventId: null,
      outcomeKey: null,
      requestedScope: 'token' as const,
      predictionLookupKind: 'token' as const,
      predictionSearchQuery: null,
      predictionTokenId: trimmed,
      symbol: trimmed,
    };
  }

  if (trimmed.startsWith('pm_event:')) {
    const eventId = trimmed.slice('pm_event:'.length).trim();
    return eventId
      ? {
          objectId: `pm:${eventId}`,
          eventId,
          outcomeKey: null,
          requestedScope: 'event' as const,
          predictionLookupKind: 'canonical_event' as const,
          predictionSearchQuery: null,
          predictionTokenId: null,
          symbol: eventId,
        }
      : null;
  }

  if (!trimmed.startsWith('pm:')) {
    const looksLikeSearchQuery = /\s|\//.test(trimmed) || !/^[A-Za-z0-9:_-]+$/.test(trimmed);
    if (looksLikeSearchQuery) {
      return {
        objectId: `pm_search:${trimmed}`,
        eventId: null,
        outcomeKey: null,
        requestedScope: 'search' as const,
        predictionLookupKind: 'search' as const,
        predictionSearchQuery: trimmed,
        predictionTokenId: null,
        symbol: trimmed,
      };
    }

    return {
      objectId: `pm:${trimmed}`,
      eventId: trimmed,
      outcomeKey: null,
      requestedScope: 'auto' as const,
      predictionLookupKind: 'market_slug' as const,
      predictionSearchQuery: null,
      predictionTokenId: null,
      symbol: trimmed,
    };
  }

  const withoutPrefix = trimmed.slice(3);
  const parts = withoutPrefix.split(':');
  const eventId = parts.shift()?.trim() ?? '';
  const rawOutcome = parts.join(':').trim();
  if (!eventId) return null;
  if (!rawOutcome) {
    return {
      objectId: `pm:${eventId}`,
      eventId,
      outcomeKey: null,
      requestedScope: 'event' as const,
      predictionLookupKind: 'canonical_event' as const,
      predictionSearchQuery: null,
      predictionTokenId: null,
      symbol: eventId,
    };
  }

  const outcomeKey = normalizeOutcomeObjectKey(rawOutcome);
  if (!outcomeKey) return null;

  return {
    objectId: `pm:${eventId}:${outcomeKey}`,
    eventId,
    outcomeKey,
    requestedScope: 'outcome' as const,
    predictionLookupKind: 'canonical_outcome' as const,
    predictionSearchQuery: null,
    predictionTokenId: null,
    symbol: eventId,
  };
}

export function normalizeDetailObject(
  input: unknown,
  index: number,
  marketHint: MarketType | null,
  scopeHint: DetailRequestScope
) {
  if (typeof input !== 'string' || !input.trim()) {
    return {
      ok: false as const,
      message: `objects[${index}] must be a non-empty string`,
    };
  }

  const requestedObjectId = input.trim();
  const market = marketHint ?? inferMarketFromObjectId(requestedObjectId);
  if (market !== 'prediction') {
    const symbol = normalizeSpotSymbol(requestedObjectId);
    return {
      ok: true as const,
      value: {
        objectId: symbol,
        requestedObjectId,
        market,
        symbol,
        eventId: null,
        outcomeKey: null,
        requestedScope: 'auto' as const,
        predictionLookupKind: null,
        predictionSearchQuery: null,
        predictionTokenId: null,
      },
    };
  }

  const prediction = normalizePredictionDetailObjectId(requestedObjectId);
  if (!prediction) {
    return {
      ok: false as const,
      message: `objects[${index}] is not a valid prediction object_id`,
    };
  }

  if (scopeHint === 'search') {
    const predictionSearchQuery =
      buildPredictionSearchQuery(requestedObjectId) ?? requestedObjectId;
    return {
      ok: true as const,
      value: {
        objectId: `pm_search:${predictionSearchQuery}`,
        requestedObjectId,
        market,
        symbol: predictionSearchQuery,
        eventId: null,
        outcomeKey: null,
        requestedScope: 'search' as const,
        predictionLookupKind: 'search' as const,
        predictionSearchQuery,
        predictionTokenId: null,
      },
    };
  }

  return {
    ok: true as const,
    value: {
      objectId: prediction.objectId,
      requestedObjectId,
      market,
      symbol: prediction.symbol,
      eventId: prediction.eventId,
      outcomeKey: prediction.outcomeKey,
      requestedScope: scopeHint === 'auto' ? prediction.requestedScope : scopeHint,
      predictionLookupKind: prediction.predictionLookupKind,
      predictionSearchQuery: prediction.predictionSearchQuery,
      predictionTokenId: prediction.predictionTokenId,
    },
  };
}

export function groupObjectsByMarket(objects: NormalizedDetailObject[]) {
  const grouped = new Map<MarketType, NormalizedDetailObject[]>();
  for (const object of objects) {
    const current = grouped.get(object.market) ?? [];
    current.push(object);
    grouped.set(object.market, current);
  }

  return [...grouped.entries()].map(([market, items]) => ({
    market,
    objects: items,
  }));
}

export function normalizeLookupKey(value: string) {
  return value.trim().toUpperCase();
}

export function findObjectPosition(
  object: NormalizedDetailObject,
  positions: DetailPositionSnapshot[]
) {
  if (object.market === 'prediction') {
    const byOutcomeKey = positions.find(
      (position) =>
        position.market === 'prediction' &&
        position.eventId === (object.eventId ?? object.symbol) &&
        object.outcomeKey != null &&
        position.outcomeName != null &&
        normalizeOutcomeObjectKey(position.outcomeName) ===
          normalizeOutcomeObjectKey(object.outcomeKey)
    );
    if (byOutcomeKey) {
      return byOutcomeKey;
    }

    return (
      positions.find(
        (position) =>
          position.market === 'prediction' &&
          position.eventId === (object.eventId ?? object.symbol)
      ) ?? null
    );
  }

  return (
    positions.find(
      (position) => position.market === object.market && position.symbol === object.symbol
    ) ?? null
  );
}

export function deriveObjectScope(object: NormalizedDetailObject): DetailObjectScope {
  if (object.market !== 'prediction') {
    return 'instrument';
  }
  if (object.requestedScope === 'search') {
    return 'search';
  }
  if (object.requestedScope === 'token') {
    return 'token';
  }
  if (object.requestedScope === 'market') {
    return object.outcomeKey ? 'outcome' : 'market';
  }
  return object.outcomeKey ? 'outcome' : 'event';
}

export function deriveCanonicalObjectId(
  object: NormalizedDetailObject,
  quote: {
    object_id: string;
  } | null
) {
  if (object.market !== 'prediction') {
    return object.objectId;
  }

  return quote?.object_id ?? (object.outcomeKey ? object.objectId : object.eventId ?? object.objectId);
}

export function shouldUseDirectPredictionMarketLookup(object: NormalizedDetailObject) {
  return (
    object.market === 'prediction' &&
    object.requestedScope !== 'event' &&
    object.requestedScope !== 'search' &&
    object.requestedScope !== 'token' &&
    (object.outcomeKey != null ||
      object.requestedScope === 'market' ||
      object.predictionLookupKind === 'market_slug' ||
      object.predictionLookupKind === 'market_url' ||
      object.predictionLookupKind === 'canonical_outcome')
  );
}

export function buildObjectRisk(
  object: NormalizedDetailObject,
  decisionContext: DetailDecisionContext
) {
  const equity = Math.max(decisionContext.totalEquity, 0);
  const maxExposureUsd = roundUsd(equity * 0.6);
  const matchedPosition = findObjectPosition(object, decisionContext.positions);
  const referencePrice =
    matchedPosition?.marketPrice != null && matchedPosition.marketPrice > 0
      ? matchedPosition.marketPrice
      : (matchedPosition?.entryPrice ?? 0);
  const currentExposureUsd = roundUsd(
    Math.max(matchedPosition?.positionSize ?? 0, 0) * Math.max(referencePrice, 0)
  );
  const remainingBuyNotionalUsd = roundUsd(Math.max(0, maxExposureUsd - currentExposureUsd));

  return {
    current_exposure_usd: currentExposureUsd,
    current_exposure_pct: equity > 0 ? roundUsd((currentExposureUsd / equity) * 100) : 0,
    max_exposure_pct: 60,
    max_exposure_usd: maxExposureUsd,
    remaining_buy_notional_usd: remainingBuyNotionalUsd,
    can_add_exposure:
      remainingBuyNotionalUsd > 0 && decisionContext.canOpenNewPositions,
  };
}
