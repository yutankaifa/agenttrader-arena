import type { MarketType } from '../db/schema';

function serializeUnknown(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

type StoredDetailRequestPredictionCandidate = {
  object_id: string;
  canonical_object_id: string | null;
  event_id: string | null;
  outcome_id: string | null;
  decision_allowed: boolean;
  allowed_actions: Array<'buy' | 'sell'>;
  blocked_reason: string | null;
  quote_source: string | null;
  quote_timestamp: string | null;
  quote_stale: boolean | null;
};

type StoredDetailRequestObjectSummary = {
  object_id: string;
  canonical_object_id: string | null;
  market: string;
  symbol: string | null;
  event_id: string | null;
  outcome_id: string | null;
  decision_allowed: boolean;
  allowed_actions: Array<'buy' | 'sell'>;
  blocked_reason: string | null;
  quote_source: string | null;
  quote_timestamp: string | null;
  quote_stale: boolean | null;
  tradable_objects: StoredDetailRequestPredictionCandidate[];
};

type StoredDetailRequestSummary = {
  summary?: unknown;
  objects?: StoredDetailRequestObjectSummary[];
};

type DetailResponseQuoteSnapshot = {
  quote_timestamp?: string | null;
  timestamp?: string | null;
  stale?: boolean | null;
  source?: string | null;
};

type DetailResponseTradableObject = {
  object_id: string;
  canonical_object_id?: string | null;
  event_id: string | null;
  outcome_id: string | null;
  decision_allowed: boolean;
  allowed_actions: Array<'buy' | 'sell'>;
  blocked_reason: string | null;
  quote: DetailResponseQuoteSnapshot | null;
};

type DetailResponseStorageObject = {
  object_id: string;
  canonical_object_id: string | null;
  market: MarketType;
  symbol: string;
  event_id: string | null;
  outcome_id: string | null;
  decision_allowed: boolean;
  allowed_actions: Array<'buy' | 'sell'>;
  blocked_reason: string | null;
  quote_source: string | null;
  quote: DetailResponseQuoteSnapshot | null;
  tradable_objects?: DetailResponseTradableObject[];
};

export type PredictionDecisionAction = {
  market: MarketType;
  side: 'buy' | 'sell';
  object_id: string;
  event_id: string | null;
  outcome_id: string | null;
};

export type PredictionDecisionContextCheck = {
  code:
    | 'PREDICTION_DETAIL_REQUIRED'
    | 'PREDICTION_OUTCOME_NOT_CONFIRMED'
    | 'PREDICTION_QUOTE_STALE'
    | 'PREDICTION_ACTION_NOT_ALLOWED';
  message: string;
  status: 409;
  details: Record<string, unknown>;
};

export type StoredDetailRequestRecord = {
  id: string;
  requested_at: string | Date | null;
  response_summary: string | null;
};

export function buildStoredDetailRequestPayload(input: {
  summary: unknown;
  objects: DetailResponseStorageObject[];
}) {
  const { summary, objects } = input;

  return serializeUnknown({
    summary,
    objects: objects.map((item) => ({
      object_id: item.object_id,
      canonical_object_id: item.canonical_object_id,
      market: item.market,
      symbol: item.symbol,
      event_id: item.event_id,
      outcome_id: item.outcome_id,
      decision_allowed: item.decision_allowed,
      allowed_actions: item.allowed_actions,
      blocked_reason: item.blocked_reason,
      quote_source: item.quote?.source ?? item.quote_source ?? null,
      quote_timestamp: item.quote?.quote_timestamp ?? item.quote?.timestamp ?? null,
      quote_stale: item.quote?.stale ?? null,
      tradable_objects: (item.tradable_objects ?? []).map((candidate) => ({
        object_id: candidate.object_id,
        canonical_object_id: candidate.canonical_object_id ?? candidate.object_id,
        event_id: candidate.event_id,
        outcome_id: candidate.outcome_id,
        decision_allowed: candidate.decision_allowed,
        allowed_actions: candidate.allowed_actions,
        blocked_reason: candidate.blocked_reason,
        quote_source: candidate.quote?.source ?? null,
        quote_timestamp:
          candidate.quote?.quote_timestamp ?? candidate.quote?.timestamp ?? null,
        quote_stale: candidate.quote?.stale ?? null,
      })),
    })),
  });
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeLookupKey(value: string) {
  return value.trim().toUpperCase();
}

function parseStoredAllowedActions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<'buy' | 'sell'>;
  }

  return value.filter(
    (item): item is 'buy' | 'sell' => item === 'buy' || item === 'sell'
  );
}

function parseStoredPredictionCandidate(
  value: unknown
): StoredDetailRequestPredictionCandidate | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.object_id !== 'string' || !record.object_id.trim()) {
    return null;
  }

  return {
    object_id: record.object_id.trim(),
    canonical_object_id:
      typeof record.canonical_object_id === 'string' && record.canonical_object_id.trim()
        ? record.canonical_object_id.trim()
        : null,
    event_id: normalizeOptionalString(record.event_id),
    outcome_id: normalizeOptionalString(record.outcome_id),
    decision_allowed: record.decision_allowed === true,
    allowed_actions: parseStoredAllowedActions(record.allowed_actions),
    blocked_reason: normalizeOptionalString(record.blocked_reason),
    quote_source: normalizeOptionalString(record.quote_source),
    quote_timestamp: normalizeOptionalString(record.quote_timestamp),
    quote_stale: typeof record.quote_stale === 'boolean' ? record.quote_stale : null,
  };
}

function parseStoredPredictionCandidateContainer(
  value: unknown
): StoredDetailRequestObjectSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = parseStoredPredictionCandidate(value);
  if (!candidate) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const market = normalizeOptionalString(record.market);
  if (!market) {
    return null;
  }

  return {
    ...candidate,
    market,
    symbol: normalizeOptionalString(record.symbol),
    tradable_objects: Array.isArray(record.tradable_objects)
      ? record.tradable_objects
          .map((item) => parseStoredPredictionCandidate(item))
          .filter(
            (item): item is StoredDetailRequestPredictionCandidate => Boolean(item)
          )
      : [],
  };
}

function parseStoredDetailRequestPayload(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const objects = Array.isArray(record.objects)
      ? record.objects
          .map((item) => parseStoredPredictionCandidateContainer(item))
          .filter(
            (item): item is StoredDetailRequestObjectSummary => Boolean(item)
          )
      : [];

    return {
      summary: record.summary,
      objects,
    } satisfies StoredDetailRequestSummary;
  } catch {
    return null;
  }
}

function buildStoredPredictionCandidateKey(input: {
  object_id: string;
  outcome_id: string | null;
}) {
  const preferred = input.outcome_id ?? input.object_id;
  return preferred ? normalizeLookupKey(preferred) : null;
}

function predictionObjectScopeRank(objectId: string) {
  return objectId.split(':').length >= 3 ? 2 : 1;
}

function shouldReplaceStoredPredictionCandidate(
  current: StoredDetailRequestPredictionCandidate,
  next: StoredDetailRequestPredictionCandidate
) {
  if (current.decision_allowed !== next.decision_allowed) {
    return next.decision_allowed;
  }

  if (current.allowed_actions.length !== next.allowed_actions.length) {
    return next.allowed_actions.length > current.allowed_actions.length;
  }

  const currentScopeRank = predictionObjectScopeRank(current.object_id);
  const nextScopeRank = predictionObjectScopeRank(next.object_id);
  if (currentScopeRank !== nextScopeRank) {
    return nextScopeRank > currentScopeRank;
  }

  if (current.blocked_reason !== next.blocked_reason) {
    return current.blocked_reason != null && next.blocked_reason == null;
  }

  return false;
}

function collectStoredPredictionCandidates(
  summary: StoredDetailRequestSummary | null
) {
  const candidates: StoredDetailRequestPredictionCandidate[] = [];

  for (const item of summary?.objects ?? []) {
    if (item.market !== 'prediction') {
      continue;
    }

    if (item.outcome_id) {
      candidates.push({
        object_id: item.object_id,
        canonical_object_id: item.canonical_object_id,
        event_id: item.event_id,
        outcome_id: item.outcome_id,
        decision_allowed: item.decision_allowed,
        allowed_actions: item.allowed_actions,
        blocked_reason: item.blocked_reason,
        quote_source: item.quote_source,
        quote_timestamp: item.quote_timestamp,
        quote_stale: item.quote_stale,
      });
    }

    candidates.push(...item.tradable_objects);
  }

  const deduped = new Map<string, StoredDetailRequestPredictionCandidate>();
  for (const candidate of candidates) {
    const key = buildStoredPredictionCandidateKey(candidate);
    if (!key) {
      continue;
    }

    const existing = deduped.get(key);
    if (!existing || shouldReplaceStoredPredictionCandidate(existing, candidate)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()];
}

export function evaluatePredictionDecisionContext(input: {
  latestRequest: StoredDetailRequestRecord | null;
  windowId: string;
  actions: PredictionDecisionAction[];
}): PredictionDecisionContextCheck | null {
  const { latestRequest, windowId, actions } = input;
  const predictionActions = actions.filter((item) => item.market === 'prediction');
  if (!predictionActions.length) {
    return null;
  }

  if (!latestRequest) {
    return {
      code: 'PREDICTION_DETAIL_REQUIRED',
      message:
        'Prediction decisions require a detail_request in the active briefing window',
      status: 409,
      details: {
        window_id: windowId,
      },
    };
  }

  const summary = parseStoredDetailRequestPayload(latestRequest.response_summary);
  const candidates = collectStoredPredictionCandidates(summary);
  if (!candidates.length) {
    return {
      code: 'PREDICTION_DETAIL_REQUIRED',
      message:
        'Prediction decisions require a current-window detail_request with concrete outcome-level objects',
      status: 409,
      details: {
        window_id: windowId,
        detail_request_id: latestRequest.id,
        detail_requested_at:
          latestRequest.requested_at instanceof Date
            ? latestRequest.requested_at.toISOString()
            : latestRequest.requested_at,
      },
    };
  }

  const candidateMap = new Map(
    candidates
      .map((candidate) => [
        buildStoredPredictionCandidateKey(candidate),
        candidate,
      ] as const)
      .filter(
        (entry): entry is [string, StoredDetailRequestPredictionCandidate] =>
          Boolean(entry[0])
      )
  );

  for (const action of predictionActions) {
    const actionKey = buildStoredPredictionCandidateKey({
      object_id: action.object_id,
      outcome_id: action.outcome_id,
    });
    const matched = actionKey ? candidateMap.get(actionKey) ?? null : null;

    if (!matched) {
      return {
        code: 'PREDICTION_OUTCOME_NOT_CONFIRMED',
        message:
          'Prediction actions must target a current-window outcome returned by the platform detail response',
        status: 409,
        details: {
          detail_request_id: latestRequest.id,
          object_id: action.object_id,
          event_id: action.event_id,
          outcome_id: action.outcome_id,
        },
      };
    }

    if (matched.quote_stale === true || matched.blocked_reason === 'QUOTE_STALE') {
      return {
        code: 'PREDICTION_QUOTE_STALE',
        message:
          'Prediction outcome quote is stale; fetch a new detail_request before trading this outcome',
        status: 409,
        details: {
          detail_request_id: latestRequest.id,
          object_id: matched.object_id,
          outcome_id: matched.outcome_id,
          quote_source: matched.quote_source,
          quote_timestamp: matched.quote_timestamp,
        },
      };
    }

    if (!matched.decision_allowed) {
      return {
        code: 'PREDICTION_ACTION_NOT_ALLOWED',
        message:
          'Prediction outcome is not currently decision-allowed in the active briefing window',
        status: 409,
        details: {
          detail_request_id: latestRequest.id,
          object_id: matched.object_id,
          outcome_id: matched.outcome_id,
          blocked_reason: matched.blocked_reason,
        },
      };
    }

    if (!matched.allowed_actions.includes(action.side)) {
      return {
        code: 'PREDICTION_ACTION_NOT_ALLOWED',
        message:
          'Prediction action side is not allowed for the confirmed outcome in the active briefing window',
        status: 409,
        details: {
          detail_request_id: latestRequest.id,
          object_id: matched.object_id,
          outcome_id: matched.outcome_id,
          attempted_side: action.side,
          allowed_actions: matched.allowed_actions,
        },
      };
    }
  }

  return null;
}
