import { getSqlClient } from '@/db/postgres';
import { createId } from '@/db/id';
import type { ActionStatus, DecisionAction, MarketType } from '@/db/schema';
import type { MarketQuote } from '@/lib/market-adapter/types';
import { getQuote as getRedisQuote, isRedisConfigured } from '@/lib/redis';
import { ensureTradeExecutionQuoteSourceColumn } from '@/lib/trade-execution-schema';
import { roundUsd } from '@/lib/utils';
import {
  type ExecutionMarketQuoteLike,
  resolveExecutionQuote,
  type ExecutionQuote,
  type ExecutionSnapshotLike,
} from './execution-quote-resolver';
import {
  buildInstrumentId,
  getLiveQuote,
  resolveOutcomeNameWithMarketData,
  roundRate,
} from './trade-engine-core';

type DatabaseDecisionActionRow = {
  id: string;
  client_action_id: string | null;
  symbol: string;
  object_id: string | null;
  side: 'buy' | 'sell';
  requested_units: number | null;
  amount_usd: number;
  market: MarketType;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
  reason_tag: string | null;
  display_rationale: string | null;
  status: ActionStatus;
  rejection_reason: string | null;
};

type DatabaseMarketSnapshotRow = {
  instrument_id: string;
  provider: string;
  quote_ts: string | Date;
  last_price: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  bid_size: number | null;
  ask_size: number | null;
  depth_snapshot: string | null;
};

type TradeExecutionWriteInput = {
  actionId: string;
  requestedUnits: number;
  filledUnits: number;
  fillPrice: number;
  slippage: number;
  fee: number;
  quoteSource: string | null;
  executionMethod: string | null;
  depthSnapshot: string | null;
  executedAt: Date;
};

export type AgentAccountCashState = {
  found: boolean;
  availableCash: number | null;
};

function mapDatabaseAction(row: DatabaseDecisionActionRow): DecisionAction {
  return {
    id: row.id,
    submissionId: '',
    clientActionId: row.client_action_id ?? row.id,
    symbol: row.symbol,
    objectId: row.object_id ?? row.symbol,
    side: row.side,
    requestedUnits: row.requested_units ?? 0,
    amountUsd: row.amount_usd,
    market: row.market,
    eventId: row.event_id,
    outcomeId: row.outcome_id,
    outcomeName: row.outcome_name,
    reasonTag: row.reason_tag ?? '',
    displayRationale: row.display_rationale ?? '',
    orderType: 'market',
    status: row.status,
    rejectionReason: row.rejection_reason,
  };
}

function mapDatabaseSnapshotToMarketDataSnapshot(
  row: DatabaseMarketSnapshotRow,
  _action: DecisionAction
): ExecutionSnapshotLike {
  return {
    provider: row.provider,
    quoteTs: row.quote_ts instanceof Date ? row.quote_ts.toISOString() : row.quote_ts,
    lastPrice: row.last_price,
    bid: row.bid,
    ask: row.ask,
    midpoint: row.midpoint,
    spread: row.spread,
    bidSize: row.bid_size,
    askSize: row.ask_size,
    depthSnapshot: row.depth_snapshot ?? null,
  };
}

function normalizeExecutionMarketQuote(
  quote: MarketQuote | null
): ExecutionMarketQuoteLike | null {
  if (!quote) {
    return null;
  }

  return {
    provider: quote.provider,
    timestamp: quote.timestamp,
    lastPrice: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
    midpoint: quote.midpoint,
    spread: quote.spread,
    bidSize: quote.bidSize,
    askSize: quote.askSize,
    depthSnapshot: quote.depthSnapshot ?? null,
  };
}

async function resolveDatabaseInstrumentIds(action: DecisionAction) {
  const sql = getSqlClient();
  const directInstrumentId = buildInstrumentId(action);
  const instrumentRows = await sql<{ id: string }[]>`
    select id
    from market_instruments
    where upper(symbol) = upper(${action.symbol})
      and market = ${action.market}
    limit 1
  `;

  return [
    directInstrumentId,
    action.symbol,
    instrumentRows[0]?.id ?? null,
  ].filter((value, index, items): value is string => Boolean(value) && items.indexOf(value) === index);
}

export async function listSubmissionActionsDatabase(submissionId: string) {
  const sql = getSqlClient();
  const rows = await sql<DatabaseDecisionActionRow[]>`
    select
      id,
      client_action_id,
      symbol,
      object_id,
      side,
      requested_units,
      amount_usd,
      market,
      event_id,
      outcome_id,
      outcome_name,
      reason_tag,
      display_rationale,
      status,
      rejection_reason
    from decision_actions
    where submission_id = ${submissionId}
    order by id asc
  `;

  return rows.map((row) => mapDatabaseAction(row));
}

export async function resolveOutcomeNameDatabase(action: DecisionAction) {
  const matchedOutcome = await resolveOutcomeNameWithMarketData(action);
  if (!matchedOutcome) {
    return action.outcomeName;
  }

  try {
    action.outcomeName = matchedOutcome;
    const sql = getSqlClient();
    await sql`
      update decision_actions
      set outcome_name = ${matchedOutcome}
      where id = ${action.id}
    `;
    return matchedOutcome;
  } catch {
    return action.outcomeName;
  }
}

export async function getExecutionQuoteDatabase(
  action: DecisionAction,
  executedAt: Date
): Promise<ExecutionQuote> {
  const sql = getSqlClient();
  const instrumentId = buildInstrumentId(action);
  const candidateInstrumentIds = await resolveDatabaseInstrumentIds(action);
  const redisConfigured = isRedisConfigured();

  return resolveExecutionQuote({
    instrumentId,
    action,
    executedAt,
    redisConfigured,
    getDbBeforeSubmission: async () => {
      const beforeRows = await sql<DatabaseMarketSnapshotRow[]>`
        select
          instrument_id,
          provider,
          quote_ts,
          last_price,
          bid,
          ask,
          midpoint,
          spread,
          bid_size,
          ask_size,
          depth_snapshot
        from market_data_snapshots
        where instrument_id = any(${candidateInstrumentIds})
          and quote_ts <= ${executedAt.toISOString()}
        order by quote_ts desc
        limit 8
      `;

      return beforeRows
        .map((row) => mapDatabaseSnapshotToMarketDataSnapshot(row, action))
        .sort((left, right) => right.quoteTs.localeCompare(left.quoteTs))[0] ?? null;
    },
    getDbLatest: async () => {
      const latestRows = await sql<DatabaseMarketSnapshotRow[]>`
        select
          instrument_id,
          provider,
          quote_ts,
          last_price,
          bid,
          ask,
          midpoint,
          spread,
          bid_size,
          ask_size,
          depth_snapshot
        from market_data_snapshots
        where instrument_id = any(${candidateInstrumentIds})
        order by quote_ts desc
        limit 8
      `;

      return latestRows
        .map((row) => mapDatabaseSnapshotToMarketDataSnapshot(row, action))
        .sort((left, right) => right.quoteTs.localeCompare(left.quoteTs))[0] ?? null;
    },
    getRedisQuote: redisConfigured
      ? async () =>
          normalizeExecutionMarketQuote(
            await getRedisQuote(
              action.symbol,
              action.market,
              action.market === 'prediction' ? action.outcomeId ?? null : null
            )
          )
      : undefined,
    getLiveQuote: async () => normalizeExecutionMarketQuote(await getLiveQuote(action)),
  });
}

export async function updateRequestedUnitsDatabase(
  actionId: string,
  requestedUnits: number
) {
  const sql = getSqlClient();
  await sql`
    update decision_actions
    set requested_units = ${requestedUnits}
    where id = ${actionId}
  `;
}

export async function getAgentAccountCashDatabase(
  agentId: string
): Promise<AgentAccountCashState> {
  const sql = getSqlClient();
  const accountRows = await sql<
    {
      available_cash: number | null;
    }[]
  >`
    select available_cash
    from agent_accounts
    where agent_id = ${agentId}
    limit 1
  `;
  const account = accountRows[0] ?? null;

  return {
    found: Boolean(account),
    availableCash: account?.available_cash ?? null,
  };
}

export async function getPositionUnitsDatabase(
  agentId: string,
  action: DecisionAction
) {
  const sql = getSqlClient();
  const positionRows = await sql<
    {
      position_size: number | null;
    }[]
  >`
    select position_size
    from positions
    where agent_id = ${agentId}
      and symbol = ${action.symbol}
      and market = ${action.market}
      and coalesce(event_id, '') = ${action.eventId ?? ''}
      and coalesce(outcome_id, '') = ${action.outcomeId ?? ''}
    limit 1
  `;

  return positionRows[0]?.position_size ?? 0;
}

export async function writeTradeExecutionDatabase(input: TradeExecutionWriteInput) {
  await ensureTradeExecutionQuoteSourceColumn();
  const sql = getSqlClient();
  await sql`
    insert into trade_executions (
      id,
      action_id,
      requested_units,
      filled_units,
      fill_price,
      slippage,
      fee,
      quote_source,
      execution_method,
      depth_snapshot,
      executed_at
    ) values (
      ${createId('exec')},
      ${input.actionId},
      ${input.requestedUnits},
      ${input.filledUnits},
      ${input.fillPrice},
      ${roundRate(input.slippage) ?? 0},
      ${roundUsd(input.fee)},
      ${input.quoteSource},
      ${input.executionMethod},
      ${input.depthSnapshot},
      ${input.executedAt.toISOString()}
    )
  `;
}

export async function rejectActionDatabase(actionId: string, reason: string) {
  const sql = getSqlClient();
  await sql`
    update decision_actions
    set
      status = 'rejected',
      rejection_reason = ${reason}
    where id = ${actionId}
  `;
}

export async function markActionExecutedDatabase(
  actionId: string,
  status: ActionStatus,
  requestedUnits: number
) {
  const sql = getSqlClient();
  await sql`
    update decision_actions
    set
      status = ${status},
      requested_units = ${requestedUnits},
      rejection_reason = ${null}
    where id = ${actionId}
  `;
}
