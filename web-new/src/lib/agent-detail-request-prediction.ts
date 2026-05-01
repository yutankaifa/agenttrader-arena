import {
  getPredictionEventDetails,
  getPredictionMarketDetails,
  searchPredictionEvents,
} from '@/lib/market-adapter';
import {
  type NormalizedDetailObject,
  type PredictionEventDetailsView,
  type PredictionMarketDetailsView,
  buildPredictionObjectId,
  shouldUseDirectPredictionMarketLookup,
} from '@/lib/agent-detail-request-objects';
import {
  buildPredictionSearchFallbackSuggestions,
  buildPredictionSearchQuery,
} from '@/lib/prediction-search';
import { getBriefingWindowSeconds } from '@/lib/trading-rules';

export async function buildPredictionMarketDetailsMap(objects: NormalizedDetailObject[]) {
  const lookupKeys = [
    ...new Set(
      objects.flatMap((item) =>
        !shouldUseDirectPredictionMarketLookup(item)
          ? []
          : [item.symbol, item.eventId ?? item.symbol, item.requestedObjectId]
      )
    ),
  ];

  const results = await Promise.all(
    lookupKeys.map(async (key) => ({
      key,
      market: await getPredictionMarketDetails(key),
    }))
  );

  return new Map(results.map((result) => [result.key, result.market]));
}

export type PredictionEventResolution = {
  event: PredictionEventDetailsView | null;
  suggestedObjects: string[];
};

function buildPredictionResolutionFromMatches(
  matches: PredictionEventDetailsView[],
  fallbackQuery?: string | null
): PredictionEventResolution {
  return {
    event: matches[0] ?? null,
    suggestedObjects: matches.length
      ? matches.map((match) => match.slug).filter(Boolean).slice(0, 5)
      : fallbackQuery
        ? buildPredictionSearchFallbackSuggestions(fallbackQuery)
        : [],
  };
}

export async function buildPredictionEventResolutionMap(objects: NormalizedDetailObject[]) {
  const resolutionEntries: Array<[string, PredictionEventResolution]> = await Promise.all(
    objects.map(async (item) => {
      if (item.market !== 'prediction') {
        return [item.objectId, { event: null, suggestedObjects: [] }];
      }

      if (item.predictionLookupKind === 'search' && item.predictionSearchQuery) {
        const matches = await searchPredictionEvents(item.predictionSearchQuery, 5);
        return [
          item.objectId,
          buildPredictionResolutionFromMatches(matches, item.predictionSearchQuery),
        ];
      }

      const lookupCandidates = [
        item.requestedObjectId,
        item.eventId,
        item.symbol,
      ].filter((value): value is string => Boolean(value));
      for (const lookup of lookupCandidates) {
        const event = await getPredictionEventDetails(lookup);
        if (event) {
          return [
            item.objectId,
            {
              event,
              suggestedObjects: event.markets
                .map((market) => market.symbol)
                .filter(Boolean)
                .slice(0, 5),
            },
          ];
          }
      }

      const fallbackSearchQuery = buildPredictionSearchQuery(
        item.predictionSearchQuery ??
          item.eventId ??
          item.symbol ??
          item.requestedObjectId
      );
      if (fallbackSearchQuery) {
        const matches = await searchPredictionEvents(fallbackSearchQuery, 5);
        if (matches.length) {
          return [
            item.objectId,
            buildPredictionResolutionFromMatches(matches, fallbackSearchQuery),
          ];
        }
      }

      return [
        item.objectId,
        {
          event: null,
          suggestedObjects:
            item.predictionSearchQuery != null
              ? buildPredictionSearchFallbackSuggestions(item.predictionSearchQuery)
              : [],
        },
      ];
    })
  );

  return new Map<string, PredictionEventResolution>(resolutionEntries);
}

export function enrichPredictionMarketDetails(
  object: NormalizedDetailObject,
  marketDetails: PredictionMarketDetailsView | null
) {
  if (object.market !== 'prediction' || !marketDetails) {
    return marketDetails;
  }

  return {
    ...marketDetails,
    outcomes: marketDetails.outcomes.map((outcome) => ({
      ...outcome,
      object_id: buildPredictionObjectId(object.eventId ?? object.symbol, outcome.name),
      external_token_id: outcome.id ?? null,
    })),
  };
}

export function enrichPredictionEventDetails(
  eventDetails: PredictionEventDetailsView | null
) {
  if (!eventDetails) {
    return null;
  }

  return {
    ...eventDetails,
    markets: eventDetails.markets.map((market) => ({
      ...market,
      outcomes: market.outcomes.map((outcome) => ({
        ...outcome,
        object_id: buildPredictionObjectId(market.symbol, outcome.name),
        external_token_id: outcome.id ?? null,
      })),
    })),
  };
}

export function buildPredictionSuggestedNextRequest(input: {
  object: NormalizedDetailObject;
  tradePolicy: { blocked_reason: string | null };
  eventResolution: PredictionEventResolution | null;
  tradableObjects:
    | Array<{
        object_id: string;
        market_slug?: string | null;
        tradable: boolean;
        decision_allowed: boolean;
      }>
    | undefined;
}) {
  const { object, tradePolicy, eventResolution, tradableObjects } = input;

  if (tradePolicy.blocked_reason === 'SELECT_TRADABLE_OUTCOME_REQUIRED') {
    const candidateOutcomeObjectIds = [
      ...(tradableObjects ?? [])
        .filter((item) => item.decision_allowed)
        .map((item) => item.object_id),
      ...(tradableObjects ?? [])
        .filter((item) => item.tradable)
        .map((item) => item.object_id),
    ].filter((value, index, items) => items.indexOf(value) === index);
    const fallbackMarketSlugs = [
      ...(tradableObjects ?? [])
        .map((item) => item.market_slug)
        .filter((item): item is string => Boolean(item)),
      ...(eventResolution?.suggestedObjects ?? []),
    ].filter((value, index, items) => items.indexOf(value) === index);

    return {
      scope: candidateOutcomeObjectIds.length > 0 ? 'outcome' : 'market',
      objects:
        candidateOutcomeObjectIds.length > 0
          ? candidateOutcomeObjectIds.slice(0, 8)
          : fallbackMarketSlugs.slice(0, 5),
      reason:
        candidateOutcomeObjectIds.length > 0
          ? 'Select one or more concrete prediction outcome object_ids before submitting a decision.'
          : 'Select one or more concrete prediction market outcomes before submitting a decision.',
    };
  }

  if (tradePolicy.blocked_reason === 'NO_PREDICTION_MARKET_MATCH') {
    const searchSeed = object.predictionSearchQuery ?? object.requestedObjectId;
    return {
      scope: 'search',
      objects: buildPredictionSearchFallbackSuggestions(searchSeed).slice(0, 5),
      reason: 'Refine the search query or provide a specific Polymarket event URL or market slug.',
    };
  }

  return null;
}

type PredictionSuggestedAlternativeCandidate = {
  object_id: string;
  tradable: boolean;
  decision_allowed: boolean;
};

export function buildPredictionSuggestedAlternatives(input: {
  object: NormalizedDetailObject;
  tradePolicy: { blocked_reason: string | null };
  tradableObjects: PredictionSuggestedAlternativeCandidate[] | undefined;
}) {
  const { object, tradePolicy, tradableObjects } = input;

  if (object.market !== 'prediction' || !tradableObjects?.length) {
    return null;
  }

  const alternativeIds = [
    ...tradableObjects
      .filter((item) => item.object_id !== object.objectId && item.decision_allowed)
      .map((item) => item.object_id),
    ...tradableObjects
      .filter(
        (item) =>
          item.object_id !== object.objectId &&
          !item.decision_allowed &&
          item.tradable
      )
      .map((item) => item.object_id),
  ].filter((value, index, items) => items.indexOf(value) === index);

  if (!alternativeIds.length) {
    return null;
  }

  if (
    tradePolicy.blocked_reason === 'SELECT_TRADABLE_OUTCOME_REQUIRED' ||
    tradePolicy.blocked_reason === 'TOP_OF_BOOK_UNRELIABLE' ||
    tradePolicy.blocked_reason === 'TOP_OF_BOOK_INCOMPLETE' ||
    tradePolicy.blocked_reason === 'QUOTE_UNAVAILABLE'
  ) {
    return alternativeIds.slice(0, 5);
  }

  return null;
}

function normalizeBlockedReason(value: string | null) {
  if (!value) return null;
  return value
    .replace(/^quote_unavailable:/, '')
    .replace(/^candles_unavailable:/, '')
    .trim()
    .toUpperCase();
}

export function buildDetailRetryGuidance(input: {
  blockedReason: string | null;
  unavailableReason: string | null;
  suggestedAlternatives: string[] | null;
}) {
  const { blockedReason, unavailableReason, suggestedAlternatives } = input;
  const retryableReasons = new Set([
    'QUOTE_UNAVAILABLE',
    'QUOTE_STALE',
    'TOP_OF_BOOK_UNRELIABLE',
    'TOP_OF_BOOK_INCOMPLETE',
    'LAST_PRICE_OUTSIDE_TOP_OF_BOOK',
    'TOP_OF_BOOK_CROSSED',
  ]);
  const normalizedUnavailableReason = normalizeBlockedReason(unavailableReason);
  const shouldRetry =
    retryableReasons.has(blockedReason ?? '') ||
    retryableReasons.has(normalizedUnavailableReason ?? '');

  return {
    retry_recommended: shouldRetry && !suggestedAlternatives?.length,
    retry_after_seconds: shouldRetry ? Math.min(getBriefingWindowSeconds(), 60) : null,
    no_trade_this_window:
      blockedReason === 'TOP_OF_BOOK_UNRELIABLE' && !suggestedAlternatives?.length,
  };
}

export function buildDetailSummary(
  objects: Array<{
    tradable: boolean;
    decision_allowed: boolean;
    blocked_reason: string | null;
    tradable_objects?: Array<{
      tradable: boolean;
      decision_allowed: boolean;
    }>;
  }>
) {
  const commonBlockedReasons = [
    ...new Set(
      objects.map((item) => item.blocked_reason).filter((reason): reason is string => Boolean(reason))
    ),
  ];
  const tradableObjects = objects.reduce((count, item) => {
    if (item.tradable_objects?.length) {
      return count + item.tradable_objects.filter((candidate) => candidate.tradable).length;
    }
    return count + (item.tradable ? 1 : 0);
  }, 0);
  const decisionAllowedObjects = objects.reduce((count, item) => {
    if (item.tradable_objects?.length) {
      return count + item.tradable_objects.filter((candidate) => candidate.decision_allowed).length;
    }
    return count + (item.decision_allowed ? 1 : 0);
  }, 0);
  const allBlockedByUnreliableBook =
    decisionAllowedObjects === 0 &&
    commonBlockedReasons.length > 0 &&
    commonBlockedReasons.every((reason) => reason === 'TOP_OF_BOOK_UNRELIABLE');

  return {
    requested_objects: objects.length,
    tradable_objects: tradableObjects,
    decision_allowed_objects: decisionAllowedObjects,
    common_blocked_reasons: commonBlockedReasons,
    recommended_action:
      decisionAllowedObjects > 0
        ? 'SELECT_FROM_DECISION_ALLOWED_OBJECTS'
        : allBlockedByUnreliableBook
          ? 'NO_TRADE_THIS_WINDOW'
          : 'NO_TRADE_THIS_WINDOW',
  };
}
