import type { ActionStatus, DecisionAction, MarketType } from '@/db/schema';
import {
  binanceAdapter,
  getPredictionMarketDetails,
  massiveAdapter,
  polymarketAdapter,
} from '@/lib/market-adapter';
import { isQuoteDebugEnabled, TRADING_FEE_RATE } from '@/lib/trading-rules';
import { roundUsd } from '@/lib/utils';
import {
  normalizeQuoteLookupError,
  type QuoteAtSubmission,
  type QuoteDebug,
} from './execution-quote-resolver';

const FEE_BPS = Math.round(TRADING_FEE_RATE * 10000);
const QUOTE_DEBUG_ENABLED = isQuoteDebugEnabled();
const EXECUTION_UNIT_TOLERANCE = 1e-6;

export function executionStatus(
  _action: DecisionAction,
  filledUnits: number,
  requestedUnits: number
): ActionStatus {
  if (filledUnits <= 0) return 'rejected';
  return filledUnits + EXECUTION_UNIT_TOLERANCE < requestedUnits
    ? 'partial'
    : 'filled';
}

export function topTierFromRank(rank: number | null) {
  if (rank == null) return 'normal';
  if (rank <= 3) return 'top_3';
  if (rank <= 10) return 'top_10';
  return 'normal';
}

function normalizeOutcomeObjectKey(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function buildCanonicalObjectId(action: DecisionAction) {
  if (action.market === 'prediction' && action.outcomeName) {
    return `pm:${action.eventId ?? action.symbol}:${normalizeOutcomeObjectKey(
      action.outcomeName
    )}`;
  }

  return action.objectId;
}

function getPublicQuoteDebug(quoteDebug: QuoteDebug | null) {
  return QUOTE_DEBUG_ENABLED ? quoteDebug : null;
}

export function buildInstrumentId(action: DecisionAction) {
  if (action.market === 'prediction' && action.outcomeId) {
    return `${action.symbol}::${action.outcomeId}`;
  }

  return action.symbol;
}

export async function getLiveQuote(action: DecisionAction) {
  const instrumentId = buildInstrumentId(action);

  if (action.market === 'stock') {
    return massiveAdapter.getQuote(action.symbol);
  }
  if (action.market === 'crypto') {
    return binanceAdapter.getQuote(action.symbol);
  }

  return polymarketAdapter.getQuote(instrumentId);
}

export function roundQty(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPrice(value: number | null) {
  if (value == null) return null;
  return Math.round(value * 10_000) / 10_000;
}

export function roundRate(value: number | null) {
  if (value == null) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundBps(value: number | null) {
  if (value == null) return null;
  return Math.round(value * 100) / 100;
}

export function normalizeUnfilledReason(reason: string) {
  if (reason.toLowerCase().includes('no_fillable_liquidity')) {
    return 'INSUFFICIENT_TOP_OF_BOOK_LIQUIDITY';
  }

  return reason.toUpperCase();
}

export function walkBook(input: {
  requestedUnits: number;
  side: string;
  quotePrice: number;
  depthSnapshot: string | null;
}) {
  const levels = parseDepthSnapshot(
    input.depthSnapshot,
    input.side,
    input.quotePrice
  );
  let remainingUnits = input.requestedUnits;
  let filledUnits = 0;
  let filledNotional = 0;

  for (const level of levels) {
    if (remainingUnits <= 0) break;
    const levelSize = Math.max(0, level.size);
    if (levelSize <= 0) continue;
    const levelFill = Math.min(levelSize, remainingUnits);
    remainingUnits -= levelFill;
    filledUnits += levelFill;
    filledNotional += levelFill * level.price;
  }

  if (filledUnits <= 0) {
    return {
      filledUnits: 0,
      fillPrice: input.quotePrice,
      slippage: 0,
      fillableNotional: 0,
    };
  }

  const avgFillPrice = filledNotional / filledUnits;
  const referencePrice = input.quotePrice || avgFillPrice;
  const slippage =
    referencePrice > 0
      ? Math.abs((avgFillPrice - referencePrice) / referencePrice)
      : 0;

  return {
    filledUnits,
    fillPrice: avgFillPrice,
    slippage,
    fillableNotional: filledNotional,
  };
}

function parseDepthSnapshot(
  depthSnapshot: string | null,
  side: string,
  quotePrice: number
) {
  try {
    const parsed = depthSnapshot ? JSON.parse(depthSnapshot) : null;
    const rawLevels = side === 'buy' ? parsed?.asks : parsed?.bids;
    if (Array.isArray(rawLevels) && rawLevels.length) {
      const levels = rawLevels
        .map((level: { price?: unknown; size?: unknown; qty?: unknown }) => ({
          price: Number(level?.price),
          size: Number(level?.size ?? level?.qty ?? 0),
        }))
        .filter(
          (level: { price: number; size: number }) =>
            Number.isFinite(level.price) && Number.isFinite(level.size)
        );
      if (levels.length) {
        return levels;
      }
    }
  } catch {
    // ignore malformed snapshots
  }

  return [{ price: quotePrice, size: Number.MAX_SAFE_INTEGER }];
}

export function buildActionResult(input: {
  action: DecisionAction;
  requestedUnits: number | null;
  status: ActionStatus;
  filledUnits: number;
  fillPrice: number | null;
  fee: number | null;
  notionalUsd: number;
  topTier: ReturnType<typeof topTierFromRank>;
  rejectionReason: string | null;
  unfilledReason: string | null;
  quoteSource: string | null;
  quoteAtSubmission: QuoteAtSubmission | null;
  quoteDebug: QuoteDebug | null;
  fillableNotionalUsdAtSubmission: number | null;
  liquidityModel: string;
  slippage: number | null;
  slippageBps: number | null;
}) {
  const {
    action,
    requestedUnits,
    status,
    filledUnits,
    fillPrice,
    fee,
    notionalUsd,
    topTier,
    rejectionReason,
    unfilledReason,
    quoteSource,
    quoteAtSubmission,
    quoteDebug,
    fillableNotionalUsdAtSubmission,
    liquidityModel,
    slippage,
    slippageBps,
  } = input;
  const canonicalObjectId = buildCanonicalObjectId(action);
  const normalizedRequestedUnits =
    requestedUnits != null && Number.isFinite(requestedUnits)
      ? roundQty(requestedUnits)
      : null;
  const normalizedFilledUnits = roundQty(filledUnits);
  const normalizedRequestedAmountUsd = roundUsd(action.amountUsd);
  const normalizedNotionalUsd = roundUsd(notionalUsd);
  const normalizedUnfilledUnits =
    normalizedRequestedUnits == null
      ? null
      : roundQty(Math.max(0, normalizedRequestedUnits - normalizedFilledUnits));
  const normalizedUnfilledAmountUsd = roundUsd(
    Math.max(0, normalizedRequestedAmountUsd - normalizedNotionalUsd)
  );

  return {
    action_id: action.clientActionId,
    action: action.side,
    symbol: action.symbol,
    object_id: canonicalObjectId,
    canonical_object_id: canonicalObjectId,
    external_token_id: action.outcomeId,
    event_id: action.eventId,
    outcome_id: action.outcomeId,
    outcome_name: action.outcomeName,
    side: action.side,
    market: action.market,
    requested_amount_usd: normalizedRequestedAmountUsd,
    requested_units: normalizedRequestedUnits,
    status,
    filled_units: status === 'rejected' ? null : normalizedFilledUnits,
    filled_amount_usd: status === 'rejected' ? null : normalizedNotionalUsd,
    unfilled_units: normalizedUnfilledUnits,
    unfilled_amount_usd: normalizedUnfilledAmountUsd,
    unfilled_reason: unfilledReason ? normalizeUnfilledReason(unfilledReason) : null,
    fill_price: roundPrice(fillPrice),
    liquidity_model: liquidityModel,
    quote_source: quoteSource,
    quote_at_submission: quoteAtSubmission,
    quote_debug: getPublicQuoteDebug(quoteDebug),
    fillable_notional_usd_at_submission:
      fillableNotionalUsdAtSubmission == null
        ? null
        : roundUsd(fillableNotionalUsdAtSubmission),
    slippage: roundRate(slippage),
    slippage_bps: roundBps(slippageBps),
    fee: status === 'rejected' ? null : fee,
    fee_bps: FEE_BPS,
    fee_currency: 'USD',
    reason_tag: action.reasonTag,
    reasoning_summary: action.displayRationale,
    rejection_reason: rejectionReason,
    notional_usd: normalizedNotionalUsd,
    top_tier: topTier,
  };
}

export type ActionResult = ReturnType<typeof buildActionResult>;

export function makeRejectedResult(input: {
  action: DecisionAction;
  requestedUnits: number | null;
  topTier: ReturnType<typeof topTierFromRank>;
  rejectionReason: string;
  quoteSource?: string | null;
  quoteAtSubmission?: QuoteAtSubmission | null;
  quoteDebug?: QuoteDebug | null;
  fillableNotionalUsdAtSubmission?: number | null;
}) {
  return buildActionResult({
    action: input.action,
    requestedUnits: input.requestedUnits,
    status: 'rejected',
    filledUnits: 0,
    fillPrice: null,
    fee: null,
    notionalUsd: 0,
    topTier: input.topTier,
    rejectionReason: input.rejectionReason,
    unfilledReason: input.rejectionReason,
    quoteSource: input.quoteSource ?? null,
    quoteAtSubmission: input.quoteAtSubmission ?? null,
    quoteDebug: input.quoteDebug ?? null,
    fillableNotionalUsdAtSubmission:
      input.fillableNotionalUsdAtSubmission ?? null,
    liquidityModel: 'top_of_book_ioc',
    slippage: null,
    slippageBps: null,
  });
}

export async function resolveOutcomeNameWithMarketData(action: DecisionAction) {
  if (action.outcomeName || action.market !== 'prediction' || !action.outcomeId) {
    return action.outcomeName;
  }

  try {
    const marketDetails = await getPredictionMarketDetails(action.symbol);
    return (
      marketDetails?.outcomes.find((outcome) => outcome.id === action.outcomeId)
        ?.name ?? null
    );
  } catch {
    return null;
  }
}

export function normalizeExecutionFailureReason(error: unknown) {
  const normalized = normalizeQuoteLookupError(error);
  return normalized === 'unknown_error' ? 'execution_error' : normalized;
}
