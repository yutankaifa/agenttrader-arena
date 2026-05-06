import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import type { RiskTag } from '@/db/schema';
import { refreshDisplayEquity } from '@/lib/display-equity';
import { buildExecutionPath } from '@/lib/execution-path';
import { ensureTradeExecutionQuoteSourceColumn } from '@/lib/trade-execution-schema';
import { ensureAgentXUrlColumn, normalizeAgentXUrl } from '@/lib/agent-x';
import {
  getBriefingWindowMinutes,
  INITIAL_CAPITAL,
} from '@/lib/trading-rules';
import { roundUsd } from '@/lib/utils';

function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent service operations');
  }
}

function toIsoValue(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export async function listOwnedAgents(userId: string) {
  requireDatabaseMode();
  await ensureAgentXUrlColumn();
  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      name: string;
      x_url: string | null;
      status: string;
      runner_status: string | null;
      last_heartbeat_at: string | Date | null;
      initial_cash: number | null;
      available_cash: number | null;
      total_equity: number | null;
      display_equity: number | null;
    }[]
  >`
    select
      a.id,
      a.name,
      a.x_url,
      a.status,
      a.runner_status,
      a.last_heartbeat_at,
      acct.initial_cash,
      acct.available_cash,
      acct.total_equity,
      acct.display_equity
    from agent_claims c
    inner join agents a on a.id = c.agent_id
    left join agent_accounts acct on acct.agent_id = a.id
    where c.claimed_by = ${userId}
      and c.status = 'claimed'
    order by coalesce(a.updated_at, a.created_at) desc, a.id asc
  `;

  return Promise.all(
    rows.map(async (row) => {
      const marked = await refreshDisplayEquity(row.id);
      const initial = marked.initialCash ?? row.initial_cash ?? INITIAL_CAPITAL;
      const equity = marked.totalEquity ?? row.total_equity ?? initial;
      const displayEquity = marked.displayEquity ?? row.display_equity ?? equity;
      return {
        id: row.id,
        name: row.name,
        xUrl: row.x_url,
        status: row.status,
        runnerStatus: row.runner_status ?? 'idle',
        initialCash: initial,
        availableCash: marked.availableCash ?? row.available_cash ?? initial,
        totalEquity: equity,
        displayEquity,
        returnRate: roundUsd(((equity - initial) / initial) * 100),
        displayReturnRate: roundUsd(((displayEquity - initial) / initial) * 100),
        riskTag: marked.riskTag ?? null,
        closeOnly: marked.closeOnly,
        lastHeartbeatAt:
          row.last_heartbeat_at instanceof Date
            ? row.last_heartbeat_at.toISOString()
            : row.last_heartbeat_at,
      };
    })
  );
}

export async function getOwnedAgentSummary(agentId: string) {
  requireDatabaseMode();
  await ensureAgentXUrlColumn();
  const sql = getSqlClient();
  const [agentRows, accountRows, runtimeRows] = await Promise.all([
    sql<
      {
        id: string;
        name: string;
        description: string | null;
        x_url: string | null;
        model_provider: string | null;
        model_name: string | null;
        runtime_environment: string | null;
        strategy_hint: string | null;
        status: string;
        runner_status: string | null;
        claim_status: string | null;
        last_heartbeat_at: string | Date | null;
      }[]
    >`
      select
        id,
        name,
        description,
        x_url,
        model_provider,
        model_name,
        runtime_environment,
        strategy_hint,
        status,
        runner_status,
        claim_status,
        last_heartbeat_at
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
        risk_tag: RiskTag;
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
    sql<
      {
        heartbeat_interval_minutes: number | null;
        last_heartbeat_at: string | Date | null;
      }[]
    >`
      select
        heartbeat_interval_minutes,
        last_heartbeat_at
      from runtime_configs
      where agent_id = ${agentId}
      limit 1
    `,
  ]);

  const agent = agentRows[0] ?? null;
  if (!agent) return null;
  const account = accountRows[0] ?? null;
  const runtime = runtimeRows[0] ?? null;
  const marked = await refreshDisplayEquity(agentId);
  const initial = marked.initialCash ?? account?.initial_cash ?? INITIAL_CAPITAL;
  const equity = marked.totalEquity ?? account?.total_equity ?? initial;
  const displayEquity = marked.displayEquity ?? account?.display_equity ?? equity;

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      xUrl: agent.x_url,
      modelProvider: agent.model_provider,
      modelName: agent.model_name,
      runtimeEnvironment: agent.runtime_environment,
      strategyHint: agent.strategy_hint,
      status: agent.status,
      runnerStatus: agent.runner_status ?? 'idle',
      claimStatus: agent.claim_status ?? 'unclaimed',
      lastHeartbeatAt: toIsoValue(agent.last_heartbeat_at),
    },
    account: {
      initialCash: initial,
      availableCash: marked.availableCash ?? account?.available_cash ?? initial,
      totalEquity: equity,
      displayEquity,
      returnRate: roundUsd(((equity - initial) / initial) * 100),
      displayReturnRate: roundUsd(((displayEquity - initial) / initial) * 100),
      riskTag: marked.riskTag ?? account?.risk_tag ?? null,
    },
    runtimeConfig: {
      heartbeatIntervalMinutes:
        runtime?.heartbeat_interval_minutes ?? getBriefingWindowMinutes(),
      lastHeartbeatAt: toIsoValue(runtime?.last_heartbeat_at ?? null),
    },
  };
}

export async function listOwnedAgentTrades(input: {
  agentId: string;
  page: number;
  pageSize: number;
}) {
  requireDatabaseMode();
  await ensureTradeExecutionQuoteSourceColumn();
  const sql = getSqlClient();
  const offset = (input.page - 1) * input.pageSize;
  const submissionRows = await sql<{ id: string }[]>`
    select id
    from decision_submissions
    where agent_id = ${input.agentId}
  `;
  const submissionIds = submissionRows.map((item) => item.id);
  if (!submissionIds.length) {
    return {
      items: [],
      meta: {
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: 0,
      },
    };
  }

  const actionRows = await sql<
    {
      id: string;
      client_action_id: string | null;
      symbol: string | null;
      object_id: string | null;
      side: string | null;
      market: string | null;
      submission_id: string;
      status: string | null;
    }[]
  >`
    select
      id,
      client_action_id,
      symbol,
      object_id,
      side,
      market,
      submission_id,
      status
    from decision_actions
    where submission_id = any(${submissionIds})
  `;
  const filledActions = actionRows.filter(
    (item) => item.status === 'filled' || item.status === 'partial'
  );
  const actionIds = filledActions.map((item) => item.id);
  const actionMap = new Map(filledActions.map((item) => [item.id, item]));
  if (!actionIds.length) {
    return {
      items: [],
      meta: {
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: 0,
      },
    };
  }

  const [totalRows, executionRows] = await Promise.all([
    sql<{ count: string | number }[]>`
      select count(*) as count
      from trade_executions
      where action_id = any(${actionIds})
    `,
    sql<
      {
        id: string;
        action_id: string;
        requested_units: number;
        filled_units: number;
        fill_price: number;
        slippage: number;
        fee: number;
        quote_source: string | null;
        execution_method: string | null;
        executed_at: string | Date | null;
      }[]
    >`
      select
        id,
        action_id,
        requested_units,
        filled_units,
        fill_price,
        slippage,
        fee,
        quote_source,
        execution_method,
        executed_at
      from trade_executions
      where action_id = any(${actionIds})
      order by executed_at desc
      limit ${input.pageSize}
      offset ${offset}
    `,
  ]);
  const total = Number(totalRows[0]?.count ?? 0);

  return {
    items: executionRows.map((execution) => {
      const action = actionMap.get(execution.action_id);
      return {
        executionId: execution.id,
        actionId: action?.client_action_id || execution.action_id,
        symbol: action?.symbol || 'Unknown',
        objectId: action?.object_id || null,
        side: action?.side || 'unknown',
        market: action?.market || 'unknown',
        requestedUnits: execution.requested_units,
        filledUnits: execution.filled_units,
        fillPrice: execution.fill_price,
        executionPath: buildExecutionPath(
          execution.quote_source,
          execution.execution_method
        ),
        slippage: execution.slippage,
        fee: execution.fee,
        executedAt: toIsoValue(execution.executed_at),
      };
    }),
    meta: {
      total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function listOwnedAgentPositions(agentId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      symbol: string;
      market: string;
      event_id: string | null;
      outcome_id: string | null;
      outcome_name: string | null;
      position_size: number;
      entry_price: number;
      market_price: number | null;
    }[]
  >`
    select
      id,
      symbol,
      market,
      event_id,
      outcome_id,
      outcome_name,
      position_size,
      entry_price,
      market_price
    from positions
    where agent_id = ${agentId}
    order by symbol asc
  `;

  return rows.map((item) => {
    const marketPrice = item.market_price ?? item.entry_price;
    const unrealizedPnl = roundUsd(
      (marketPrice - item.entry_price) * item.position_size
    );

    return {
      id: item.id,
      symbol: item.symbol,
      market: item.market,
      eventId: item.event_id ?? null,
      outcomeId: item.outcome_id ?? null,
      outcomeName: item.outcome_name ?? null,
      positionSize: item.position_size,
      entryPrice: item.entry_price,
      marketPrice,
      unrealizedPnl,
    };
  });
}

export async function getOwnedAgentEquity(agentId: string, range: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const durationMap: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  const durationMs = durationMap[range];
  const cutoff = durationMs ? new Date(Date.now() - durationMs) : null;
  const rows = cutoff
    ? await sql<
        {
          ts: string | Date | null;
          cash: number | null;
          equity: number | null;
          drawdown: number | null;
          return_rate: number | null;
        }[]
      >`
        select ts, cash, equity, drawdown, return_rate
        from account_snapshots
        where agent_id = ${agentId}
          and ts >= ${cutoff}
        order by ts asc
      `
    : await sql<
        {
          ts: string | Date | null;
          cash: number | null;
          equity: number | null;
          drawdown: number | null;
          return_rate: number | null;
        }[]
      >`
        select ts, cash, equity, drawdown, return_rate
        from account_snapshots
        where agent_id = ${agentId}
        order by ts asc
      `;
  const marked = await refreshDisplayEquity(agentId);
  const liveReturn =
    marked.initialCash > 0
      ? roundUsd(
          ((marked.displayEquity - marked.initialCash) / marked.initialCash) * 100
        )
      : 0;

  if (!rows.length) {
    return {
      series: [],
      stats: {
        currentEquity: marked.displayEquity,
        maxDrawdown: 0,
        totalReturn: liveReturn,
        dataPoints: 0,
      },
    };
  }

  const historicalPeak = Math.max(
    marked.displayEquity,
    ...rows.map((item) => item.equity ?? marked.displayEquity)
  );
  const liveDrawdown =
    historicalPeak > 0
      ? roundUsd(((marked.displayEquity - historicalPeak) / historicalPeak) * 100)
      : 0;
  const liveTimestamp = new Date().toISOString();
  const lastSnapshot = rows.at(-1) ?? null;
  const seriesRows =
    (lastSnapshot?.equity ?? null) !== marked.displayEquity
      ? [
          ...rows,
          {
            ts: liveTimestamp,
            cash: marked.availableCash,
            equity: marked.displayEquity,
            drawdown: liveDrawdown,
            return_rate: liveReturn,
          },
        ]
      : rows;

  return {
    series: seriesRows.map((item) => ({
      ts: toIsoValue(item.ts),
      equity: item.equity ?? 0,
      cash: item.cash ?? 0,
      drawdown: item.drawdown ?? 0,
      returnRate: item.return_rate ?? 0,
    })),
    stats: {
      currentEquity: marked.displayEquity,
      maxDrawdown: Math.min(...seriesRows.map((item) => item.drawdown ?? 0)),
      totalReturn: liveReturn,
      dataPoints: seriesRows.length,
    },
  };
}

export async function updateOwnedAgentXUrl(agentId: string, xUrl: string | null) {
  requireDatabaseMode();
  await ensureAgentXUrlColumn();
  const normalized = normalizeAgentXUrl(xUrl);
  if (!normalized.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: normalized.message,
    };
  }

  const sql = getSqlClient();
  const now = new Date().toISOString();
  await sql`
    update agents
    set
      x_url = ${normalized.value},
      updated_at = ${now}
    where id = ${agentId}
  `;

  return {
    ok: true as const,
    data: {
      xUrl: normalized.value,
    },
  };
}

export async function listOwnedAgentLogs(input: {
  agentId: string;
  page: number;
  pageSize: number;
  status: string;
}) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const validStatusFilter =
    input.status === 'accepted' ||
    input.status === 'rejected' ||
    input.status === 'pending';
  const offset = (input.page - 1) * input.pageSize;
  const statusClause = validStatusFilter ? sql`and status = ${input.status}` : sql``;
  const [totalRows, submissionRows] = await Promise.all([
    sql<{ count: string | number }[]>`
      select count(*) as count
      from decision_submissions
      where agent_id = ${input.agentId}
      ${statusClause}
    `,
    sql<
      {
        id: string;
        decision_id: string;
        decision_rationale: string | null;
        reasoning_summary: string | null;
        reason_tag: string | null;
        status: string | null;
        rejection_reason: string | null;
        received_at: string | Date | null;
      }[]
    >`
      select
        id,
        decision_id,
        decision_rationale,
        fallback_reasoning_summary as reasoning_summary,
        reason_tag,
        status,
        rejection_reason,
        received_at
      from decision_submissions
      where agent_id = ${input.agentId}
      ${statusClause}
      order by received_at desc
      limit ${input.pageSize}
      offset ${offset}
    `,
  ]);
  const total = Number(totalRows[0]?.count ?? 0);
  if (total === 0) {
    return {
      items: [],
      meta: {
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: 0,
      },
    };
  }

  const submissionIds = submissionRows.map((item) => item.id);
  const actionRows = submissionIds.length
    ? await sql<
        {
          submission_id: string;
          client_action_id: string | null;
          id: string;
          symbol: string | null;
          object_id: string | null;
          side: string | null;
          requested_units: number | null;
          amount_usd: number | null;
          market: string | null;
          order_type: string | null;
          status: string | null;
          rejection_reason: string | null;
        }[]
      >`
        select
          submission_id,
          client_action_id,
          id,
          symbol,
          object_id,
          side,
          requested_units,
          amount_usd,
          market,
          order_type,
          status,
          rejection_reason
        from decision_actions
        where submission_id = any(${submissionIds})
      `
    : [];

  const actionsBySubmission = new Map<string, Array<Record<string, unknown>>>();
  for (const action of actionRows) {
    const current = actionsBySubmission.get(action.submission_id) ?? [];
    current.push({
      actionId: action.client_action_id || action.id,
      symbol: action.symbol,
      objectId: action.object_id ?? null,
      side: action.side,
      requestedUnits: action.requested_units,
      amountUsd: action.amount_usd ?? null,
      market: action.market,
      orderType: action.order_type || 'market',
      status: action.status || 'pending',
      rejectionReason: action.rejection_reason || null,
    });
    actionsBySubmission.set(action.submission_id, current);
  }

  return {
    items: submissionRows.map((submission) => ({
      submissionId: submission.id,
      decisionId: submission.decision_id,
      decisionRationale: submission.decision_rationale || null,
      fallbackReasoningSummary: submission.reasoning_summary || '',
      reasonTag: submission.reason_tag || '',
      status: submission.status || 'pending',
      rejectionReason: submission.rejection_reason || null,
      receivedAt: toIsoValue(submission.received_at),
      actions: actionsBySubmission.get(submission.id) ?? [],
    })),
    meta: {
      total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function setOwnedAgentRunnerStatus(
  agentId: string,
  runnerStatus: 'running' | 'idle'
) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const now = new Date().toISOString();
  await sql`
    update agents
    set
      runner_status = ${runnerStatus},
      updated_at = ${now}
    where id = ${agentId}
  `;
  return { runnerStatus };
}

export async function setOwnedAgentPaused(agentId: string, paused: boolean) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const now = new Date().toISOString();
  await sql`
    update agents
    set
      status = ${paused ? 'paused' : 'active'},
      runner_status = ${paused ? 'idle' : 'ready'},
      updated_at = ${now}
    where id = ${agentId}
  `;
  return { status: paused ? 'paused' : 'active' };
}

export async function deleteOwnedAgent(agentId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  await sql.begin(async (tx) => {
    await tx`delete from system_actions where agent_id = ${agentId}`;
    await tx`delete from agent_daily_summaries where agent_id = ${agentId}`;
    await tx`delete from risk_events where agent_id = ${agentId}`;
    await tx`delete from detail_requests where agent_id = ${agentId}`;
    await tx`delete from agent_error_reports where agent_id = ${agentId}`;
    await tx`delete from audit_logs where agent_id = ${agentId}`;
    await tx`delete from agent_briefings where agent_id = ${agentId}`;
    await tx`delete from agent_protocol_events where agent_id = ${agentId}`;
    await tx`delete from leaderboard_snapshots where agent_id = ${agentId}`;
    await tx`delete from account_snapshots where agent_id = ${agentId}`;
    await tx`delete from live_trade_events where agent_id = ${agentId}`;
    await tx`
      delete from trade_executions
      where action_id in (
        select da.id
        from decision_actions da
        inner join decision_submissions ds on ds.id = da.submission_id
        where ds.agent_id = ${agentId}
      )
    `;
    await tx`
      delete from decision_actions
      where submission_id in (
        select id from decision_submissions where agent_id = ${agentId}
      )
    `;
    await tx`delete from decision_submissions where agent_id = ${agentId}`;
    await tx`delete from positions where agent_id = ${agentId}`;
    await tx`delete from agent_accounts where agent_id = ${agentId}`;
    await tx`delete from runtime_configs where agent_id = ${agentId}`;
    await tx`delete from agent_api_keys where agent_id = ${agentId}`;
    await tx`delete from agent_claims where agent_id = ${agentId}`;
    await tx`delete from agents where id = ${agentId}`;
  });
  return { deleted: true };
}
