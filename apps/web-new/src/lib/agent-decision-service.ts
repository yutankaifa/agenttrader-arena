import { createId } from '@/db/id';
import {
  AGENT_REQUEST_TYPE,
  AGENT_RESPONSE_TYPE,
  AGENT_SCHEMA_VERSION,
  buildExpectedTypeMessage,
  buildTypedProtocolPayload,
} from '@/contracts/agent-protocol';
import { getSqlClient } from '@/db/postgres';
import type { MarketType } from '@/db/schema';
import { getRiskMode } from '@/lib/account-metrics';
import {
  buildDecisionPersistencePlan,
  summarizeDecisionExecution,
} from '@/lib/agent-persistence-plan';
import {
  isDecisionWindowConsumptionConflict,
  updateDecisionSubmissionExecutionResult,
  writeDecisionPersistencePlan,
} from '@/lib/agent-persistence-db';
import { getAgentRuntimeState } from '@/lib/agent-runtime';
import {
  normalizeOptionalString,
  normalizeOutcomeObjectKey,
  normalizeRequiredString,
  requireDatabaseMode,
} from '@/lib/agent-runtime-service-common';
import { refreshDisplayEquity } from '@/lib/display-equity';
import {
  ensureMarketDataForSymbols,
  getPredictionMarketDetails,
} from '@/lib/market-adapter';
import { getOwnedAgentSummary, listOwnedAgentPositions } from '@/lib/owned-agent-service';
import { ensurePlatformCompetitionExists } from '@/lib/platform-context';
import {
  checkBuyLimit,
  checkCloseOnly,
  checkDecisionWindow,
  checkMarketSession,
  checkPositionConcentration,
  checkPredictionRules,
  checkTerminated,
} from '@/lib/risk-checks';
import { getBriefingWindowId } from '@/lib/trading-rules';
import { executeActions } from '@/lib/trade-engine';
import { validatePredictionDecisionContext } from '@/lib/prediction-detail-context';
import { normalizeWhitespace, roundUsd } from '@/lib/utils';

type NormalizedAction = {
  action_id: string;
  side: 'buy' | 'sell';
  market: MarketType;
  symbol: string;
  object_id: string;
  amount_usd: number;
  reason_tag: string;
  reasoning_summary: string;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
  requested_units: number;
};

type PredictionMarketDetailsView = Awaited<ReturnType<typeof getPredictionMarketDetails>>;

function normalizeReasonTag(value: string) {
  return normalizeWhitespace(value.replace(/[_-]+/g, ' '));
}

type SentenceAnalysis = {
  count: number;
  segments: string[];
};

function analyzeSentenceStructure(value: string): SentenceAnalysis {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return { count: 0, segments: [] };
  }

  const segments: string[] = [];
  const trailingClosers = new Set([
    '"',
    "'",
    ')',
    ']',
    '}',
    '”',
    '’',
    '）',
    '】',
    '》',
    '」',
    '』',
  ]);
  let segmentStart = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (!'.!?。！？;；'.includes(char)) {
      continue;
    }

    const prevChar = normalized[index - 1] ?? '';
    const nextChar = normalized[index + 1] ?? '';
    if (char === '.' && /\d/.test(prevChar) && /\d/.test(nextChar)) {
      continue;
    }

    let boundaryEnd = index + 1;
    while (
      boundaryEnd < normalized.length &&
      trailingClosers.has(normalized[boundaryEnd])
    ) {
      boundaryEnd += 1;
    }

    let nextContentIndex = boundaryEnd;
    while (
      nextContentIndex < normalized.length &&
      /\s/.test(normalized[nextContentIndex])
    ) {
      nextContentIndex += 1;
    }

    if (nextContentIndex === boundaryEnd && nextContentIndex < normalized.length) {
      continue;
    }

    const segment = normalized.slice(segmentStart, boundaryEnd).trim();
    if (segment) {
      segments.push(segment);
    }
    segmentStart = nextContentIndex;
    index = Math.max(index, nextContentIndex - 1);
  }

  const tail = normalized.slice(segmentStart).trim();
  if (tail) {
    segments.push(tail);
  }

  return {
    count: segments.length,
    segments,
  };
}

function roundDecimal(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatSignedPercent(decimalValue: number) {
  const percent = decimalValue * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function normalizeDecisionMarket(value: unknown): MarketType | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (
    ['stock', 'stocks', 'equity', 'equities', 'us_equities'].includes(normalized)
  ) {
    return 'stock';
  }
  if (['crypto', 'cryptocurrency', 'cryptocurrencies'].includes(normalized)) {
    return 'crypto';
  }
  if (
    ['prediction', 'predictions', 'prediction_market', 'prediction_markets'].includes(
      normalized
    )
  ) {
    return 'prediction';
  }
  return null;
}

function normalizeSpotDecisionObjectId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('eq:')) {
    return trimmed.slice(3).trim().toUpperCase() || null;
  }
  if (trimmed.startsWith('crypto:')) {
    return trimmed.slice(7).trim().replace(/-USD$/i, '').toUpperCase() || null;
  }

  return trimmed.toUpperCase();
}

function normalizePredictionDecisionObjectId(
  value: string,
  outcomeName?: string | null
) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('pm:')) {
    const parts = trimmed.slice(3).split(':');
    const eventId = parts.shift()?.trim() ?? '';
    const outcomeRaw = parts.join(':').trim();
    const outcomeKey = normalizeOutcomeObjectKey(outcomeRaw || outcomeName || '');
    if (!eventId || !outcomeKey) return null;
    return {
      object_id: `pm:${eventId}:${outcomeKey}`,
      event_id: eventId,
      outcome_key: outcomeKey,
    };
  }

  const normalizedOutcomeKey = normalizeOutcomeObjectKey(outcomeName ?? '');
  if (!normalizedOutcomeKey) {
    return null;
  }

  return {
    object_id: `pm:${trimmed}:${normalizedOutcomeKey}`,
    event_id: trimmed,
    outcome_key: normalizedOutcomeKey,
  };
}

export function derivePredictionDecisionSymbol(input: {
  object_id: string;
  event_id?: string | null;
  outcome_name?: string | null;
}) {
  const normalizedObject = normalizePredictionDecisionObjectId(
    input.object_id,
    input.outcome_name
  );
  if (!normalizedObject) {
    return null;
  }

  // Execution quotes must use the market slug from object_id. Event ids can be
  // broader series/event aliases and are not reliable quote lookup keys.
  return normalizedObject.event_id;
}

function normalizePredictionToken(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function findPredictionOutcomeByKey(
  marketDetails: PredictionMarketDetailsView | null,
  outcomeKey: string
) {
  return (
    marketDetails?.outcomes.find(
      (outcome) => normalizeOutcomeObjectKey(outcome.name) === outcomeKey
    ) ?? null
  );
}

async function getPredictionMarketDetailsCached(
  eventId: string,
  cache: Map<string, Promise<PredictionMarketDetailsView | null>>
) {
  if (!cache.has(eventId)) {
    cache.set(eventId, getPredictionMarketDetails(eventId));
  }

  return (await cache.get(eventId)) ?? null;
}

async function normalizeDecisionActionIdentity(
  market: MarketType,
  input: {
    object_id: string;
    symbol?: unknown;
    event_id?: unknown;
    outcome_id?: unknown;
    outcome_name?: unknown;
  },
  predictionMarketCache: Map<string, Promise<PredictionMarketDetailsView | null>>
) {
  if (market !== 'prediction') {
    const symbol = normalizeSpotDecisionObjectId(input.object_id);
    if (!symbol) {
      return { ok: false as const, message: 'object_id is invalid' };
    }

    return {
      ok: true as const,
      value: {
        object_id: symbol,
        symbol,
        event_id: null,
        outcome_id: null,
        outcome_name: null,
      },
    };
  }

  const normalizedObject = normalizePredictionDecisionObjectId(
    input.object_id,
    normalizeOptionalString(input.outcome_name)
  );
  if (!normalizedObject) {
    return {
      ok: false as const,
      message:
        'object_id is invalid for prediction; use pm:<event_slug>:<outcome_name>',
    };
  }

  const symbol = derivePredictionDecisionSymbol({
    object_id: input.object_id,
    event_id: normalizePredictionToken(input.event_id),
    outcome_name: normalizeOptionalString(input.outcome_name),
  });
  const eventId = normalizePredictionToken(
    input.event_id ?? symbol ?? normalizedObject.event_id
  );
  let outcomeId = normalizePredictionToken(input.outcome_id);
  let outcomeName = normalizeOptionalString(input.outcome_name);

  if (normalizedObject.outcome_key && (!outcomeId || !outcomeName)) {
    const marketDetails = await getPredictionMarketDetailsCached(
      eventId ?? normalizedObject.event_id,
      predictionMarketCache
    );
    const matchedOutcome = findPredictionOutcomeByKey(
      marketDetails,
      normalizedObject.outcome_key
    );
    if (matchedOutcome) {
      outcomeId ??= normalizePredictionToken(matchedOutcome.id);
      outcomeName ??= matchedOutcome.name;
    }
  }

  if (!eventId) {
    return {
      ok: false as const,
      message: 'event_id must be valid for prediction',
    };
  }
  if (!outcomeId) {
    return {
      ok: false as const,
      message:
        'outcome_id is required for prediction; use a resolvable pm:<event_slug>:<outcome_name> object_id or provide the token id explicitly',
    };
  }
  if (eventId === outcomeId) {
    return {
      ok: false as const,
      message: 'outcome_id must be an outcome-level identifier, not the event slug',
    };
  }

  return {
    ok: true as const,
    value: {
      object_id: normalizedObject.object_id,
      symbol: symbol ?? eventId,
      event_id: eventId,
      outcome_id: outcomeId,
      outcome_name: outcomeName,
    },
  };
}

async function normalizeDecisionAction(
  action: unknown,
  index: number,
  predictionMarketCache: Map<string, Promise<PredictionMarketDetailsView | null>>
): Promise<
  | { ok: true; value: NormalizedAction }
  | { ok: false; message: string }
> {
  if (!action || typeof action !== 'object') {
    return { ok: false, message: `actions[${index}] must be an object` };
  }

  const raw = action as Record<string, unknown>;
  const actionId = normalizeRequiredString(raw.action_id, `actions[${index}].action_id`);
  if (!actionId.ok) return actionId;

  const side = raw.action;
  if (side !== 'buy' && side !== 'sell') {
    return {
      ok: false,
      message: `actions[${index}].action must be "buy" or "sell"`,
    };
  }

  if (raw.market == null) {
    return {
      ok: false,
      message: `actions[${index}].market is required`,
    };
  }

  const market = normalizeDecisionMarket(raw.market);
  if (!market) {
    return {
      ok: false,
      message:
        `actions[${index}].market must be one of: stock, crypto, prediction ` +
        `(accepted aliases: us_equities, equities, stocks, prediction_markets)`,
    };
  }

  const objectId = normalizeRequiredString(raw.object_id, `actions[${index}].object_id`);
  if (!objectId.ok) return objectId;

  const amountUsd =
    typeof raw.amount_usd === 'number' && Number.isFinite(raw.amount_usd)
      ? raw.amount_usd
      : NaN;
  if (!(amountUsd > 0)) {
    return {
      ok: false,
      message: `actions[${index}].amount_usd must be a positive number`,
    };
  }

  const reasonTag = normalizeRequiredString(raw.reason_tag, `actions[${index}].reason_tag`);
  if (!reasonTag.ok) return reasonTag;
  const normalizedReasonTag = normalizeReasonTag(reasonTag.value);
  const reasonTagWordCount = normalizedReasonTag.split(/\s+/).filter(Boolean).length;
  if (reasonTagWordCount < 2 || reasonTagWordCount > 4) {
    return {
      ok: false,
      message: `actions[${index}].reason_tag must be 2-4 words`,
    };
  }
  const reasoningSummary = normalizeRequiredString(
    raw.reasoning_summary,
    `actions[${index}].reasoning_summary`
  );
  if (!reasoningSummary.ok) return reasoningSummary;
  const normalizedReasoningSummary = normalizeWhitespace(reasoningSummary.value);
  if (normalizedReasoningSummary.length < 20 || normalizedReasoningSummary.length > 1600) {
    return {
      ok: false,
      message: `actions[${index}].reasoning_summary must be 20-1600 characters`,
    };
  }
  const reasoningSentenceCount = analyzeSentenceStructure(
    normalizedReasoningSummary
  ).count;
  if (reasoningSentenceCount < 1 || reasoningSentenceCount > 4) {
    return {
      ok: false,
      message:
        `actions[${index}].reasoning_summary must be 1-4 complete sentences; ` +
        `detected ${reasoningSentenceCount}`,
    };
  }

  const normalized = await normalizeDecisionActionIdentity(
    market,
    {
      object_id: objectId.value,
      symbol: raw.symbol,
      event_id: raw.event_id,
      outcome_id: raw.outcome_id,
      outcome_name: raw.outcome_name,
    },
    predictionMarketCache
  );

  if (!normalized.ok) {
    return {
      ok: false,
      message: `actions[${index}].${normalized.message}`,
    };
  }

  return {
    ok: true,
    value: {
      action_id: actionId.value,
      side,
      market,
      symbol: normalized.value.symbol,
      object_id: normalized.value.object_id,
      amount_usd: roundUsd(amountUsd),
      reason_tag: normalizedReasonTag,
      reasoning_summary: normalizedReasoningSummary,
      event_id: normalized.value.event_id,
      outcome_id: normalized.value.outcome_id,
      outcome_name: normalized.value.outcome_name,
      requested_units: 0,
    },
  };
}

async function buildPostTradeSnapshot(agentId: string) {
  const sql = getSqlClient();
  const [summary, positions, drawdownRows] = await Promise.all([
    getOwnedAgentSummary(agentId),
    listOwnedAgentPositions(agentId),
    sql<{ drawdown: number | null }[]>`
      select drawdown
      from account_snapshots
      where agent_id = ${agentId}
      order by ts desc
      limit 1
    `,
  ]);
  if (!summary) {
    return null;
  }
  const latestDrawdown = drawdownRows[0]?.drawdown ?? 0;

  return {
    account: {
      cash: roundUsd(summary.account.availableCash),
      equity: roundUsd(summary.account.displayEquity),
      return_decimal: roundDecimal(
        (summary.account.displayEquity - summary.account.initialCash) /
          Math.max(summary.account.initialCash, 1)
      ),
      return_display: formatSignedPercent(
        (summary.account.displayEquity - summary.account.initialCash) /
          Math.max(summary.account.initialCash, 1)
      ),
      drawdown_decimal: roundDecimal(latestDrawdown / 100),
      drawdown_display: formatSignedPercent(latestDrawdown / 100),
    },
    positions: positions.map((position) => ({
      symbol: position.symbol,
      market: position.market,
      object_id:
        position.market === 'prediction' && position.outcomeName
          ? `pm:${position.eventId}:${normalizeOutcomeObjectKey(position.outcomeName)}`
          : position.symbol,
      event_id: position.eventId,
      outcome_id: position.outcomeId,
      outcome_name: position.outcomeName,
      qty: position.positionSize,
      avg_price: position.entryPrice,
      market_price: position.marketPrice ?? position.entryPrice,
    })),
    risk_status: {
      current_mode: getRiskMode({
        riskTag: summary.account.riskTag,
        cash: summary.account.availableCash,
        equity: summary.account.displayEquity,
      }),
      can_trade: summary.account.riskTag !== 'terminated',
      can_open_new_positions: !['terminated', 'close_only'].includes(
        summary.account.riskTag ?? ''
      ),
      risk_tag: summary.account.riskTag,
    },
  };
}

async function writeRejectedSubmission(input: {
  agentId: string;
  decisionId: string;
  windowId: string;
  decisionRationale: string;
  rejectionCode: string;
  actions: NormalizedAction[];
}) {
  if (input.rejectionCode === 'DECISION_WINDOW_LIMIT') {
    return;
  }

  try {
    const competitionId = await ensurePlatformCompetitionExists();
    const now = new Date().toISOString();
    const persistence = buildDecisionPersistencePlan({
      createId,
      decisionId: input.decisionId,
      agentId: input.agentId,
      competitionId,
      decisionRationale: input.decisionRationale,
      windowId: input.windowId,
      status: 'rejected',
      rejectionReason: input.rejectionCode,
      receivedAt: now,
      actions: input.actions,
    });
    const sql = getSqlClient();
    await writeDecisionPersistencePlan(sql, persistence);
  } catch {
    // audit failure must not block the main response
  }
}

export async function submitDecision(agentId: string, body: unknown) {
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
  if (payload.type != null && payload.type !== AGENT_REQUEST_TYPE.decision) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: buildExpectedTypeMessage(AGENT_REQUEST_TYPE.decision),
    };
  }

  const decisionId = normalizeRequiredString(payload.decision_id, 'decision_id');
  if (!decisionId.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: decisionId.message,
    };
  }
  const rationale = normalizeRequiredString(
    payload.decision_rationale,
    'decision_rationale'
  );
  if (!rationale.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: rationale.message,
    };
  }
  const normalizedDecisionRationale = normalizeWhitespace(rationale.value);
  if (
    normalizedDecisionRationale.length < 20 ||
    normalizedDecisionRationale.length > 1200
  ) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'decision_rationale must be 20-1200 characters',
    };
  }

  const agentState = await getAgentRuntimeState(agentId);
  if (!agentState?.lastHeartbeatAt) {
    return {
      ok: false as const,
      status: 403,
      code: 'BRIEFING_REQUIRED',
      message: 'Fetch briefing before submitting a decision',
    };
  }

  const activeWindowId = getBriefingWindowId(agentState.lastHeartbeatAt);
  const requestWindow = normalizeRequiredString(payload.window_id, 'window_id');
  if (!requestWindow.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: requestWindow.message,
    };
  }
  if (requestWindow.value !== activeWindowId) {
    return {
      ok: false as const,
      status: 409,
      code: 'STALE_WINDOW',
      message: 'window_id does not match the active briefing window',
      details: {
        active_window_id: activeWindowId,
        received_window_id: requestWindow.value,
      },
    };
  }

  if (!Array.isArray(payload.actions)) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'actions must be an array',
    };
  }
  if (payload.actions.length === 0 || payload.actions.length > 5) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'actions must contain 1-5 items',
    };
  }

  const predictionMarketCache = new Map<
    string,
    Promise<PredictionMarketDetailsView | null>
  >();
  const normalizedActions = await Promise.all(
    payload.actions.map((action, index) =>
      normalizeDecisionAction(action, index, predictionMarketCache)
    )
  );
  const invalidAction = normalizedActions.find((item) => !item.ok);
  if (invalidAction && !invalidAction.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: invalidAction.message,
    };
  }
  const actions = normalizedActions.map(
    (item) => (item as { ok: true; value: NormalizedAction }).value
  );
  const actionIds = new Set(actions.map((item) => item.action_id));
  if (actionIds.size !== actions.length) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'action_id must be unique within the decision',
    };
  }

  await refreshDisplayEquity(agentId);

  let duplicateDecision = false;
  let historicalActionIds = new Set<string | null>();
  let currentEquity = 1;
  const sql = getSqlClient();
  const [duplicateDecisionRows, historicalActionRows, accountRows] =
    await Promise.all([
      sql<{ id: string }[]>`
        select id
        from decision_submissions
        where agent_id = ${agentId}
          and decision_id = ${decisionId.value}
        limit 1
      `,
      sql<{ client_action_id: string | null }[]>`
        select da.client_action_id
        from decision_actions da
        inner join decision_submissions ds on ds.id = da.submission_id
        where ds.agent_id = ${agentId}
          and da.client_action_id = any(${actions.map((item) => item.action_id)})
      `,
      sql<{ total_equity: number | null }[]>`
        select total_equity
        from agent_accounts
        where agent_id = ${agentId}
        limit 1
      `,
    ]);
  duplicateDecision = Boolean(duplicateDecisionRows[0]);
  historicalActionIds = new Set(
    historicalActionRows.map((item) => item.client_action_id)
  );
  currentEquity = Math.max(accountRows[0]?.total_equity ?? 0, 1);

  if (duplicateDecision) {
    return {
      ok: false as const,
      status: 409,
      code: 'DUPLICATE_DECISION',
      message: 'This decision_id has already been submitted',
    };
  }

  const duplicateActionId = actions.find((item) =>
    historicalActionIds.has(item.action_id)
  );
  if (duplicateActionId) {
    return {
      ok: false as const,
      status: 409,
      code: 'DUPLICATE_ACTION',
      message: 'action_id has already been used by this agent',
      details: { duplicate_action_ids: [duplicateActionId.action_id] },
    };
  }

  for (const action of actions) {
    const isLargeTrade = action.amount_usd > currentEquity * 0.2;
    const sentenceCount = analyzeSentenceStructure(action.reasoning_summary).count;
    if (!isLargeTrade && (sentenceCount < 1 || sentenceCount > 2)) {
      return {
        ok: false as const,
        status: 400,
        code: 'BAD_REQUEST',
        message:
          `reasoning_summary for action_id ${action.action_id} must be 1-2 sentences ` +
          `when amount_usd is at or below 20% of equity; detected ${sentenceCount}`,
      };
    }
    if (isLargeTrade) {
      if (sentenceCount < 2 || sentenceCount > 4) {
        return {
          ok: false as const,
          status: 400,
          code: 'BAD_REQUEST',
          message:
            `reasoning_summary for action_id ${action.action_id} must be 2-4 sentences ` +
            `when amount_usd exceeds 20% of equity; detected ${sentenceCount}`,
        };
      }
      if (action.reasoning_summary.length < 80) {
        return {
          ok: false as const,
          status: 400,
          code: 'BAD_REQUEST',
          message:
            `reasoning_summary for action_id ${action.action_id} must explain edge, ` +
            `risk control, and sizing when amount_usd exceeds 20% of equity`,
        };
      }
    }
  }

  const terminatedCheck = await checkTerminated(agentId);
  if (terminatedCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: terminatedCheck.code,
      actions,
    });
    return { ok: false as const, ...terminatedCheck };
  }
  const windowCheck = await checkDecisionWindow(agentId, activeWindowId!);
  if (windowCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: windowCheck.code,
      actions,
    });
    return { ok: false as const, ...windowCheck };
  }

  for (const market of ['stock', 'crypto'] as const) {
    const symbols = [
      ...new Set(
        actions.filter((item) => item.market === market).map((item) => item.symbol)
      ),
    ];
    if (!symbols.length) {
      continue;
    }
    await ensureMarketDataForSymbols(market, symbols, {
      candlesInterval: '1h',
      candlesLimit: 24,
    });
  }

  const marketCheck = await checkMarketSession(actions);
  if (marketCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: marketCheck.code,
      actions,
    });
    return { ok: false as const, ...marketCheck };
  }
  const closeOnlyCheck = await checkCloseOnly(agentId, actions);
  if (closeOnlyCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: closeOnlyCheck.code,
      actions,
    });
    return { ok: false as const, ...closeOnlyCheck };
  }
  const buyLimitCheck = await checkBuyLimit(agentId, actions);
  if (buyLimitCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: buyLimitCheck.code,
      actions,
    });
    return { ok: false as const, ...buyLimitCheck };
  }
  const concentrationCheck = await checkPositionConcentration(agentId, actions);
  if (concentrationCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: concentrationCheck.code,
      actions,
    });
    return { ok: false as const, ...concentrationCheck };
  }
  const predictionCheck = await checkPredictionRules(agentId, actions);
  if (predictionCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: predictionCheck.code,
      actions,
    });
    return { ok: false as const, ...predictionCheck };
  }
  const predictionDecisionContextCheck = await validatePredictionDecisionContext(
    agentId,
    activeWindowId,
    actions
  );
  if (predictionDecisionContextCheck) {
    await writeRejectedSubmission({
      agentId,
      decisionId: decisionId.value,
      windowId: activeWindowId,
      decisionRationale: normalizedDecisionRationale,
      rejectionCode: predictionDecisionContextCheck.code,
      actions,
    });
    return { ok: false as const, ...predictionDecisionContextCheck };
  }

  const competitionId = await ensurePlatformCompetitionExists();
  const now = new Date();
  const persistence = buildDecisionPersistencePlan({
    createId,
    decisionId: decisionId.value,
    agentId,
    competitionId,
    decisionRationale: normalizedDecisionRationale,
    windowId: activeWindowId,
    status: 'accepted',
    rejectionReason: null,
    receivedAt: now.toISOString(),
    actions,
  });
  const submissionId = persistence.submission.id;
  try {
    await writeDecisionPersistencePlan(sql, persistence);
  } catch (error) {
    if (isDecisionWindowConsumptionConflict(error)) {
      return {
        ok: false as const,
        code: 'DECISION_WINDOW_LIMIT',
        message: 'Only one decision is allowed per briefing window',
        status: 409,
        details: { window_id: activeWindowId },
      };
    }
    throw error;
  }

  const executionResults = await executeActions(
    agentId,
    submissionId,
    competitionId,
    now
  );
  const executionSummary = summarizeDecisionExecution({
    actions: executionResults.map((item) => ({
      status: item.status,
      rejection_reason: item.rejection_reason,
    })),
  });
  await updateDecisionSubmissionExecutionResult(sql, {
    submissionId,
    status: executionSummary.submissionStatus,
    rejectionReason: executionSummary.rejectionReason,
  });

  const postTrade = await buildPostTradeSnapshot(agentId);
  return {
    ok: true as const,
    data: buildTypedProtocolPayload({
      type: AGENT_RESPONSE_TYPE.decisionExecutionResult,
      schemaVersion: AGENT_SCHEMA_VERSION.decisionExecutionResult,
      now,
      body: {
        request_success: true,
        execution_status: executionSummary.executionStatus,
        portfolio_changed: executionSummary.portfolioChanged,
        submission_id: submissionId,
        decision_id: decisionId.value,
        window_id: activeWindowId,
        decision_rationale: normalizedDecisionRationale,
        actions: executionResults,
        post_trade_account: postTrade?.account ?? null,
        post_trade_positions: postTrade?.positions ?? [],
        post_trade_risk_status: postTrade?.risk_status ?? null,
      },
    }),
  };
}
