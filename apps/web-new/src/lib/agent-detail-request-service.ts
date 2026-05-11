import { createId } from '@/db/id';
import {
  AGENT_REQUEST_TYPE,
  AGENT_RESPONSE_TYPE,
  AGENT_SCHEMA_VERSION,
  buildExpectedTypeMessage,
  buildTypedProtocolPayload,
} from '@/contracts/agent-protocol';
import { getSqlClient } from '@/db/postgres';
import { writeDetailRequestPersistenceRow } from '@/lib/agent-persistence-db';
import { buildDetailRequestPersistenceRow } from '@/lib/agent-persistence-plan';
import {
  type DetailDecisionContext,
  type NormalizedDetailObject,
  type PredictionMarketDetailsView,
  buildObjectRisk,
  deriveCanonicalObjectId,
  deriveObjectScope,
  groupObjectsByMarket,
  normalizeDetailMarketHint,
  normalizeDetailObject,
  normalizeDetailScope,
  normalizeLookupKey,
  shouldUseDirectPredictionMarketLookup,
} from '@/lib/agent-detail-request-objects';
import {
  type PredictionEventResolution,
  buildDetailRetryGuidance,
  buildDetailSummary,
  buildPredictionEventResolutionMap,
  buildPredictionMarketDetailsMap,
  buildPredictionSuggestedAlternatives,
  buildPredictionSuggestedNextRequest,
  enrichPredictionEventDetails,
  enrichPredictionMarketDetails,
} from '@/lib/agent-detail-request-prediction';
import {
  type DetailQuoteResult,
  buildPredictionOutcomeQuoteContext,
  buildQuoteContext,
  buildCandleContext,
  resolvePredictionQuoteResult,
} from '@/lib/agent-detail-request-market-data';
import {
  buildDetailDataQuality,
  buildQuoteView,
  buildTradableObjects,
  collectDetailWarnings,
  deriveDetailTradePolicy,
  deriveUnavailableReason,
} from '@/lib/agent-detail-request-tradeability';
import { getAgentRuntimeState } from '@/lib/agent-runtime';
import { buildStoredDetailRequestPayload } from '@/lib/prediction-detail-contract';
import { refreshDisplayEquity } from '@/lib/display-equity';
import { ensureMarketDataForSymbols } from '@/lib/market-adapter';
import { ensurePlatformCompetitionExists } from '@/lib/platform-context';
import {
  normalizeRequiredString,
  requireDatabaseMode,
} from '@/lib/agent-runtime-service-common';
import { getBriefingWindowId } from '@/lib/trading-rules';
import { normalizeWhitespace } from '@/lib/utils';

export async function submitDetailRequest(agentId: string, body: unknown) {
  requireDatabaseMode();
  if (!body || typeof body !== 'object') {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Invalid JSON body',
    };
  }

  const payload = body as Record<string, unknown>;
  if (payload.type != null && payload.type !== AGENT_REQUEST_TYPE.detailRequest) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: buildExpectedTypeMessage(AGENT_REQUEST_TYPE.detailRequest),
    };
  }

  const requestId = normalizeRequiredString(payload.request_id, 'request_id');
  if (!requestId.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: requestId.message,
    };
  }
  const reason = normalizeRequiredString(payload.reason, 'reason');
  if (!reason.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: reason.message,
    };
  }
  const normalizedReason = normalizeWhitespace(reason.value);
  if (normalizedReason.length < 20 || normalizedReason.length > 800) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'reason must be 20-800 characters',
    };
  }
  if (!Array.isArray(payload.objects) || payload.objects.length === 0) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'objects must be a non-empty array',
    };
  }
  if (payload.objects.length > 5) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Maximum 5 objects per request',
      details: {
        max: 5,
        received: payload.objects.length,
      },
    };
  }

  const marketHint =
    payload.market === undefined ? null : normalizeDetailMarketHint(payload.market);
  if (payload.market !== undefined && !marketHint) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'market must be one of: stock, crypto, prediction',
    };
  }
  const scopeHint = normalizeDetailScope(payload.scope);
  if (!scopeHint) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'scope must be one of: auto, search, event, market, outcome, token',
    };
  }

  const runtimeState = await getAgentRuntimeState(agentId);
  if (!runtimeState?.lastHeartbeatAt) {
    return {
      ok: false as const,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Get briefing first before using detail-request',
    };
  }

  const activeWindow = getBriefingWindowId(runtimeState.lastHeartbeatAt);
  if (!activeWindow) {
    return {
      ok: false as const,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Get briefing first before using detail-request',
    };
  }
  const requestWindow = normalizeRequiredString(payload.window_id, 'window_id');
  if (!requestWindow.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: requestWindow.message,
    };
  }
  if (requestWindow.value !== activeWindow) {
    return {
      ok: false as const,
      status: 409,
      code: 'STALE_WINDOW',
      message: 'window_id does not match the active briefing window',
      details: {
        active_window_id: activeWindow,
        received_window_id: requestWindow.value,
      },
    };
  }

  const normalizedObjects = payload.objects.map((item, index) =>
    normalizeDetailObject(item, index, marketHint, scopeHint)
  );
  const invalidObject = normalizedObjects.find((item) => !item.ok);
  if (invalidObject && !invalidObject.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: invalidObject.message,
    };
  }

  const objects = normalizedObjects.map(
    (item) => (item as { ok: true; value: NormalizedDetailObject }).value
  );
  const duplicateWarnings = [
    ...new Set(
      objects
        .map((item) => item.objectId)
        .filter((objectId, index, items) => items.indexOf(objectId) !== index)
    ),
  ].map((objectId) => ({
    code: 'DUPLICATE_OBJECTS_DEDUPED',
    message: 'Multiple request objects resolved to the same canonical object.',
    canonical_object_id: objectId,
  }));

  const marked = await refreshDisplayEquity(agentId);
  if (marked.riskTag === 'terminated' || marked.displayEquity <= 0) {
    return {
      ok: false as const,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Agent is terminated — no further queries allowed',
    };
  }

  const decisionContext: DetailDecisionContext = {
    status: runtimeState?.status ?? null,
    pausedByOperator: runtimeState?.operatorPaused ?? false,
    riskTag: marked.riskTag,
    totalEquity: marked.displayEquity,
    availableCash: marked.availableCash,
    canOpenNewPositions:
      !runtimeState?.operatorPaused &&
      marked.riskTag !== 'close_only' &&
      marked.displayEquity > 0,
    positions: marked.markedPositions,
  };

  const sql = getSqlClient();
  const priorRequestRows = await sql<{ total: number }[]>`
    select count(*)::int as total
    from detail_requests
    where agent_id = ${agentId}
      and briefing_window_id = ${activeWindow}
  `;
  const priorRequestsCount = Number(priorRequestRows[0]?.total ?? 0);
  if (priorRequestsCount >= 1) {
    return {
      ok: false as const,
      status: 429,
      code: 'RATE_LIMIT',
      message: 'Only 1 detail request is allowed in the current briefing window',
      details: {
        retry_hint: 'Fetch the next briefing window before sending another detail request',
      },
    };
  }

  const grouped = groupObjectsByMarket(objects);
  const responses = await Promise.all(
    grouped.map(async ({ market, objects: marketObjects }) => {
      const symbols = [
        ...new Set(
          marketObjects.flatMap((item) =>
            market === 'prediction'
              ? shouldUseDirectPredictionMarketLookup(item)
                ? [item.symbol]
                : []
              : [item.symbol]
          )
        ),
      ];
      const predictionRefreshSymbols =
        market === 'prediction'
          ? marketObjects
              .filter((item) => shouldUseDirectPredictionMarketLookup(item))
              .map((item) => item.symbol)
              .filter((symbol) => !/^https?:\/\//i.test(symbol))
          : [];
      if (market === 'stock' || market === 'crypto') {
        await ensureMarketDataForSymbols(market, symbols, {
          candlesInterval: '1h',
          candlesLimit: 24,
        });
      } else if (predictionRefreshSymbols.length) {
        await ensureMarketDataForSymbols(
          'prediction',
          [...new Set(predictionRefreshSymbols)],
          {
            candlesInterval: '1h',
            candlesLimit: 24,
          }
        );
      }

      const [quoteContext, candleContext, marketDetailsMap, eventResolutionMap] =
        await Promise.all([
          buildQuoteContext(
            market,
            symbols.map((symbol) => ({ symbol }))
          ),
          buildCandleContext(market, symbols, '1h', 24),
          market === 'prediction'
            ? buildPredictionMarketDetailsMap(marketObjects)
            : Promise.resolve(new Map<string, PredictionMarketDetailsView | null>()),
          market === 'prediction'
            ? buildPredictionEventResolutionMap(marketObjects)
            : Promise.resolve(new Map<string, PredictionEventResolution>()),
        ]);
      const predictionOutcomeQuoteContext =
        market === 'prediction'
          ? await buildPredictionOutcomeQuoteContext(
              marketObjects,
              marketDetailsMap,
              eventResolutionMap
            )
          : new Map<string, DetailQuoteResult>();

      return marketObjects.map((item) => {
        const eventResolution =
          item.market === 'prediction'
            ? eventResolutionMap.get(item.objectId) ?? null
            : null;
        const eventDetails = eventResolution?.event ?? null;
        const marketDetails =
          item.market === 'prediction'
            ? (marketDetailsMap.get(item.objectId) ??
              marketDetailsMap.get(item.symbol) ??
              null)
            : null;
        const quoteResult =
          item.market === 'prediction'
            ? resolvePredictionQuoteResult({
                item,
                quoteContext,
                predictionOutcomeQuoteContext,
                marketDetails,
              })
            : quoteContext.get(normalizeLookupKey(item.symbol));
        const candleResult = candleContext.get(normalizeLookupKey(item.symbol));
        const quote = quoteResult?.quote ?? null;
        const candles = candleResult?.candles ?? [];
        const quoteView = buildQuoteView({
          market,
          quote,
          quoteSource: quoteResult?.source ?? 'unavailable',
          candles,
          object: item,
          marketDetails,
        });
        const candlesError =
          candleResult && 'error' in candleResult
            ? candleResult.error ?? null
            : null;
        const warnings = collectDetailWarnings({
          market,
          quote,
          candles,
          marketDetails,
          quoteError: quoteResult?.error ?? null,
          candlesError,
        });
        const unavailableReason = deriveUnavailableReason({
          market,
          object: item,
          quote,
          candles,
          eventDetails,
          marketDetails,
          warnings,
        });
        const objectRisk = buildObjectRisk(item, decisionContext);
        const tradePolicy = deriveDetailTradePolicy({
          object: item,
          decisionContext,
          eventDetails,
          marketDetails,
          objectRisk,
          unavailableReason,
          quoteAvailable: Boolean(quoteView.quote),
        });
        const tradableObjects = buildTradableObjects(
          item,
          eventDetails,
          marketDetails,
          decisionContext,
          predictionOutcomeQuoteContext
        );
        const canonicalObjectId =
          item.market === 'prediction' && !item.outcomeKey && eventDetails?.slug
            ? eventDetails.slug
            : deriveCanonicalObjectId(item, quoteView.quote);
        const suggestedNextRequest = buildPredictionSuggestedNextRequest({
          object: item,
          tradePolicy,
          eventResolution,
          tradableObjects,
        });
        const suggestedAlternatives = buildPredictionSuggestedAlternatives({
          object: item,
          tradePolicy,
          tradableObjects,
        });
        const retryGuidance = buildDetailRetryGuidance({
          blockedReason: tradePolicy.blocked_reason,
          unavailableReason,
          suggestedAlternatives,
        });

        return {
          object_id: item.objectId,
          requested_object_id: item.requestedObjectId,
          canonical_object_id: canonicalObjectId,
          object_scope:
            item.market === 'prediction' &&
            !item.outcomeKey &&
            marketDetails &&
            !eventDetails
              ? 'market'
              : deriveObjectScope(item),
          market,
          symbol: item.symbol,
          event_id: eventDetails?.slug ?? item.eventId ?? null,
          outcome_id: quoteView.quote?.outcome_id ?? null,
          external_token_id: quoteView.quote?.external_token_id ?? null,
          quote: quoteView.quote,
          quote_source: quoteResult?.source ?? 'unavailable',
          quote_error: quoteResult?.error ?? null,
          candles_interval: '1h',
          data_quality: buildDetailDataQuality({
            market,
            item,
            quoteView,
            candles,
            warnings,
          }),
          candles: candles.map((candle) => ({
            open_time: candle.openTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
          candles_source: candleResult?.source ?? 'unavailable',
          candles_error: candlesError,
          tradable: tradePolicy.tradable,
          decision_allowed: tradePolicy.decision_allowed,
          allowed_actions: tradePolicy.allowed_actions as Array<'buy' | 'sell'>,
          blocked_reason: tradePolicy.blocked_reason,
          object_risk: objectRisk,
          unavailable_reason: unavailableReason,
          warnings,
          depth: quoteView.depth,
          tradable_objects: tradableObjects,
          decision_allowed_objects:
            tradableObjects?.filter((candidate) => candidate.decision_allowed) ?? [],
          suggested_alternatives: suggestedAlternatives,
          retry_recommended: retryGuidance.retry_recommended,
          retry_after_seconds: retryGuidance.retry_after_seconds,
          no_trade_this_window: retryGuidance.no_trade_this_window,
          suggested_next_request: suggestedNextRequest,
          event_details: enrichPredictionEventDetails(eventDetails),
          market_details: enrichPredictionMarketDetails(item, marketDetails),
        };
      });
    })
  );
  const responseObjects = responses
    .flat()
    .filter((item, index, items) => {
      const dedupeKey = `${item.market}::${item.canonical_object_id ?? item.object_id}`;
      return (
        index ===
        items.findIndex(
          (candidate) =>
            `${candidate.market}::${candidate.canonical_object_id ?? candidate.object_id}` ===
            dedupeKey
        )
      );
    });

  const detailRecordPayload = buildStoredDetailRequestPayload({
    summary: buildDetailSummary(responseObjects),
    objects: responseObjects,
  })!;
  const requestedAt = new Date().toISOString();

  const competitionId = await ensurePlatformCompetitionExists();
  const detailRow = buildDetailRequestPersistenceRow({
    createId,
    agentId,
    competitionId,
    requestId: requestId.value,
    decisionWindowStart: runtimeState.lastHeartbeatAt,
    briefingWindowId: activeWindow,
    requestReason: normalizedReason,
    objectsRequested: objects.map((item) => item.objectId),
    symbolsRequested: objects.map((item) => item.symbol),
    responseSummary: detailRecordPayload,
    requestedAt,
  });
  await writeDetailRequestPersistenceRow(sql, detailRow);

  return {
    ok: true as const,
    data: buildTypedProtocolPayload({
      type: AGENT_RESPONSE_TYPE.detailResponse,
      schemaVersion: AGENT_SCHEMA_VERSION.detailResponse,
      body: {
        request_id: requestId.value,
        window_id: activeWindow,
        objects: responseObjects,
        warnings: duplicateWarnings,
        detail_summary: buildDetailSummary(responseObjects),
        rate_limit: {
          used: 1,
          limit: 1,
          window: 'per_briefing_window',
        },
      },
    }),
  };
}
