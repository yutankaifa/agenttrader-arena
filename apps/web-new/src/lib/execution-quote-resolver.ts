const MAX_STALE_DB_QUOTE_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_DB_QUOTE_SKEW_MS = 2 * 60 * 1000;

export type QuoteAtSubmission = {
  last_price: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  timestamp: string;
};

export type QuoteDebugStep = {
  status: 'hit' | 'miss' | 'stale' | 'error' | 'skipped';
  method?: string | null;
  message?: string | null;
  timestamp?: string | null;
  last_price?: number | null;
};

export type QuoteDebug = {
  instrument_id: string;
  market: string;
  side: string;
  decision_submitted_at: string;
  selected_source: string | null;
  price_found: boolean;
  rejection_reason: string | null;
  db_before_submission: QuoteDebugStep;
  db_latest: QuoteDebugStep;
  redis: QuoteDebugStep;
  live: QuoteDebugStep;
};

export type ExecutionQuote = {
  price: number | null;
  method: string;
  source: string | null;
  found: boolean;
  depthSnapshot: string | null;
  rejectionReason: string | null;
  quoteAtSubmission: QuoteAtSubmission | null;
  quoteDebug: QuoteDebug;
};

export type ExecutionActionLike = {
  market: string;
  side: string;
};

export type ExecutionSnapshotLike = {
  provider: string;
  quoteTs: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
  depthSnapshot: string | null;
};

export type ExecutionMarketQuoteLike = {
  provider: string;
  timestamp: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
  depthSnapshot: string | null;
};

function buildQuoteAtSubmissionFromSnapshot(quote: ExecutionSnapshotLike | null) {
  if (!quote) {
    return null;
  }

  return {
    last_price: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
    midpoint: quote.midpoint,
    spread: quote.spread,
    timestamp: quote.quoteTs,
  } satisfies QuoteAtSubmission;
}

function buildQuoteAtSubmissionFromMarketQuote(quote: ExecutionMarketQuoteLike | null) {
  if (!quote) {
    return null;
  }

  return {
    last_price: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
    midpoint: quote.midpoint,
    spread: quote.spread,
    timestamp: quote.timestamp,
  } satisfies QuoteAtSubmission;
}

function buildSyntheticDepthSnapshot(input: {
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

function buildQuoteDebugStep(
  status: QuoteDebugStep['status'],
  method: string,
  timestamp: string,
  lastPrice: number | null
) {
  return {
    status,
    method,
    timestamp,
    last_price: lastPrice,
  };
}

function finalizeExecutionQuoteResult(
  result: Omit<ExecutionQuote, 'quoteDebug'>,
  quoteDebug: QuoteDebug
): ExecutionQuote {
  quoteDebug.selected_source = result.source;
  quoteDebug.price_found = result.found;
  quoteDebug.rejection_reason = result.rejectionReason;

  return {
    ...result,
    quoteDebug,
  };
}

export function normalizeQuoteLookupError(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name || 'unknown_error';
  }

  return typeof error === 'string' && error.trim() ? error.trim() : 'unknown_error';
}

export function isAcceptableExecutionSnapshot(quoteTs: string, executedAt: Date) {
  const snapshotTs = new Date(quoteTs);
  if (Number.isNaN(snapshotTs.getTime())) {
    return false;
  }

  const deltaMs = executedAt.getTime() - snapshotTs.getTime();
  if (deltaMs >= 0) {
    return deltaMs <= MAX_STALE_DB_QUOTE_AGE_MS;
  }

  return Math.abs(deltaMs) <= MAX_FUTURE_DB_QUOTE_SKEW_MS;
}

function getPredictionQuoteRejectionReason(
  action: ExecutionActionLike,
  quoteAtSubmission: QuoteAtSubmission | null
) {
  if (action.market !== 'prediction' || !quoteAtSubmission) {
    return null;
  }

  const { last_price: lastPrice, bid, ask, spread } = quoteAtSubmission;
  if (lastPrice == null) {
    return 'quote_unavailable';
  }
  if (bid == null || ask == null) {
    return 'top_of_book_incomplete';
  }
  if (ask < bid) {
    return 'top_of_book_crossed';
  }
  if (lastPrice < bid || lastPrice > ask) {
    return 'last_price_outside_top_of_book';
  }
  const normalizedSpread =
    spread ?? (Number.isFinite(bid) && Number.isFinite(ask) ? Math.max(0, ask - bid) : null);
  if (
    (bid <= 0.02 && ask >= 0.98) ||
    (normalizedSpread != null && normalizedSpread >= 0.9)
  ) {
    return 'top_of_book_unreliable';
  }

  return null;
}

function buildExecutionQuoteFromSnapshot(
  action: ExecutionActionLike,
  quote: ExecutionSnapshotLike,
  method: string,
  source: string | null
) {
  const quoteAtSubmission = buildQuoteAtSubmissionFromSnapshot(quote);
  const price =
    action.side === 'buy'
      ? (quote.ask ?? quote.lastPrice)
      : (quote.bid ?? quote.lastPrice);

  return {
    price,
    method,
    source,
    found: true,
    depthSnapshot:
      quote.depthSnapshot ??
      buildSyntheticDepthSnapshot({
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        timestamp: quote.quoteTs,
      }),
    rejectionReason: getPredictionQuoteRejectionReason(action, quoteAtSubmission),
    quoteAtSubmission,
  };
}

function buildExecutionQuoteFromMarketQuote(
  action: ExecutionActionLike,
  quote: ExecutionMarketQuoteLike,
  method: string,
  source: string | null
) {
  const quoteAtSubmission = buildQuoteAtSubmissionFromMarketQuote(quote);
  const price =
    action.side === 'buy'
      ? (quote.ask ?? quote.lastPrice)
      : (quote.bid ?? quote.lastPrice);

  return {
    price,
    method,
    source,
    found: true,
    depthSnapshot:
      quote.depthSnapshot ??
      buildSyntheticDepthSnapshot({
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        timestamp: quote.timestamp,
      }),
    rejectionReason: getPredictionQuoteRejectionReason(action, quoteAtSubmission),
    quoteAtSubmission,
  };
}

export async function resolveExecutionQuote(input: {
  instrumentId: string;
  action: ExecutionActionLike;
  executedAt: Date;
  redisConfigured: boolean;
  getDbBeforeSubmission: () => Promise<ExecutionSnapshotLike | null>;
  getDbLatest: () => Promise<ExecutionSnapshotLike | null>;
  getRedisQuote?: () => Promise<ExecutionMarketQuoteLike | null>;
  getLiveQuote: () => Promise<ExecutionMarketQuoteLike | null>;
}) {
  const executedAtIso = input.executedAt.toISOString();
  const quoteDebug: QuoteDebug = {
    instrument_id: input.instrumentId,
    market: input.action.market,
    side: input.action.side,
    decision_submitted_at: executedAtIso,
    selected_source: null,
    price_found: false,
    rejection_reason: null,
    db_before_submission: { status: 'miss' },
    db_latest: { status: 'miss' },
    redis: input.redisConfigured
      ? { status: 'miss' }
      : {
          status: 'skipped',
          message: 'redis_not_configured',
        },
    live: { status: 'miss' },
  };

  try {
    const dbBeforeSubmission = await input.getDbBeforeSubmission();
    if (dbBeforeSubmission?.lastPrice) {
      quoteDebug.db_before_submission = buildQuoteDebugStep(
        'hit',
        'walk_book',
        dbBeforeSubmission.quoteTs,
        dbBeforeSubmission.lastPrice
      );
      return finalizeExecutionQuoteResult(
        buildExecutionQuoteFromSnapshot(
          input.action,
          dbBeforeSubmission,
          'walk_book',
          `db:${dbBeforeSubmission.provider}`
        ),
        quoteDebug
      );
    }

    quoteDebug.db_before_submission = {
      status: 'miss',
      method: 'walk_book',
      message: 'no_db_snapshot_at_or_before_submission',
    };

    const dbLatest = await input.getDbLatest();
    if (dbLatest?.lastPrice && isAcceptableExecutionSnapshot(dbLatest.quoteTs, input.executedAt)) {
      quoteDebug.db_latest = buildQuoteDebugStep(
        'hit',
        'db_recent_quote',
        dbLatest.quoteTs,
        dbLatest.lastPrice
      );
      return finalizeExecutionQuoteResult(
        buildExecutionQuoteFromSnapshot(
          input.action,
          dbLatest,
          'db_recent_quote',
          `db:${dbLatest.provider}`
        ),
        quoteDebug
      );
    }

    if (dbLatest?.lastPrice) {
      quoteDebug.db_latest = {
        status: 'stale',
        method: 'db_recent_quote',
        message: `snapshot_outside_execution_tolerance:${dbLatest.quoteTs}`,
        timestamp: dbLatest.quoteTs,
        last_price: dbLatest.lastPrice,
      };
    } else {
      quoteDebug.db_latest = {
        status: 'miss',
        method: 'db_recent_quote',
        message: 'no_latest_db_snapshot',
      };
    }
  } catch (error) {
    const message = normalizeQuoteLookupError(error);
    quoteDebug.db_before_submission = {
      status: 'error',
      method: 'walk_book',
      message,
    };
    quoteDebug.db_latest = {
      status: 'error',
      method: 'db_recent_quote',
      message,
    };
  }

  if (input.redisConfigured) {
    try {
      const redisQuote = await input.getRedisQuote?.();
      if (redisQuote) {
        quoteDebug.redis = buildQuoteDebugStep(
          'hit',
          'redis_quote',
          redisQuote.timestamp,
          redisQuote.lastPrice
        );
        return finalizeExecutionQuoteResult(
          buildExecutionQuoteFromMarketQuote(
            input.action,
            redisQuote,
            'redis_quote',
            `redis:${redisQuote.provider}`
          ),
          quoteDebug
        );
      }

      quoteDebug.redis = {
        status: 'miss',
        method: 'redis_quote',
        message: 'no_redis_quote',
      };
    } catch (error) {
      quoteDebug.redis = {
        status: 'error',
        method: 'redis_quote',
        message: normalizeQuoteLookupError(error),
      };
    }
  }

  try {
    const liveQuote = await input.getLiveQuote();
    if (liveQuote) {
      quoteDebug.live = buildQuoteDebugStep(
        'hit',
        'live_quote',
        liveQuote.timestamp,
        liveQuote.lastPrice
      );
      return finalizeExecutionQuoteResult(
        buildExecutionQuoteFromMarketQuote(
          input.action,
          liveQuote,
          'live_quote',
          `live:${liveQuote.provider}`
        ),
        quoteDebug
      );
    }

    quoteDebug.live = {
      status: 'miss',
      method: 'live_quote',
      message: 'live_provider_returned_no_quote',
    };
  } catch (error) {
    quoteDebug.live = {
      status: 'error',
      method: 'live_quote',
      message: normalizeQuoteLookupError(error),
    };
  }

  return finalizeExecutionQuoteResult(
    {
      price: 1,
      method: 'fallback',
      source: null,
      found: false,
      depthSnapshot: null,
      rejectionReason: null,
      quoteAtSubmission: null,
    },
    quoteDebug
  );
}
