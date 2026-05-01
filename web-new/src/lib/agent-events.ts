import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { createId } from '@/db/id';
import { readStore, updateStore } from '@/db/store';
import { serializeUnknown } from '@/lib/utils';

export async function writeAuditEvent(input: {
  agentId: string | null;
  eventType: string;
  payload?: unknown;
  createdAt?: Date;
}) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    await sql`
      insert into audit_logs (
        id, agent_id, event_type, payload, created_at
      ) values (
        ${createId('audit')},
        ${input.agentId},
        ${input.eventType},
        ${serializeUnknown(input.payload)},
        ${(input.createdAt ?? new Date()).toISOString()}
      )
    `;
    return;
  }

  return await updateStore((store) => {
    store.auditLogs.push({
      id: createId('audit'),
      agentId: input.agentId,
      eventType: input.eventType,
      payload: serializeUnknown(input.payload),
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    });
  });
}

export async function writeAgentBriefing(input: {
  agentId: string;
  briefingWindowId: string | null;
  payload: unknown;
  createdAt?: Date;
}) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    await sql`
      insert into agent_briefings (
        id, agent_id, briefing_window_id, payload, created_at
      ) values (
        ${createId('briefing')},
        ${input.agentId},
        ${input.briefingWindowId},
        ${serializeUnknown(input.payload) ?? '{}'},
        ${(input.createdAt ?? new Date()).toISOString()}
      )
    `;
    return;
  }

  return await updateStore((store) => {
    store.agentBriefings.push({
      id: createId('briefing'),
      agentId: input.agentId,
      briefingWindowId: input.briefingWindowId,
      payload: serializeUnknown(input.payload) ?? '{}',
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    });
  });
}

export async function writeAgentErrorReport(input: {
  agentId: string;
  reportType: 'api_error' | 'runtime_exception' | 'unexpected_result';
  sourceEndpoint?: string | null;
  httpMethod?: string | null;
  requestId?: string | null;
  decisionId?: string | null;
  windowId?: string | null;
  errorCode?: string | null;
  statusCode?: number | null;
  summary: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  runtimeContext?: unknown;
  createdAt?: Date;
}) {
  const reportId = createId('err');
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    await sql`
      insert into agent_error_reports (
        id,
        agent_id,
        report_type,
        source_endpoint,
        http_method,
        request_id,
        decision_id,
        window_id,
        error_code,
        status_code,
        summary,
        request_payload,
        response_payload,
        runtime_context,
        created_at
      ) values (
        ${reportId},
        ${input.agentId},
        ${input.reportType},
        ${input.sourceEndpoint ?? null},
        ${input.httpMethod ?? null},
        ${input.requestId ?? null},
        ${input.decisionId ?? null},
        ${input.windowId ?? null},
        ${input.errorCode ?? null},
        ${input.statusCode ?? null},
        ${input.summary},
        ${serializeUnknown(input.requestPayload)},
        ${serializeUnknown(input.responsePayload)},
        ${serializeUnknown(input.runtimeContext)},
        ${(input.createdAt ?? new Date()).toISOString()}
      )
    `;
    return reportId;
  }

  await updateStore((store) => {
    store.agentErrorReports.push({
      id: reportId,
      agentId: input.agentId,
      reportType: input.reportType,
      sourceEndpoint: input.sourceEndpoint ?? null,
      httpMethod: input.httpMethod ?? null,
      requestId: input.requestId ?? null,
      decisionId: input.decisionId ?? null,
      windowId: input.windowId ?? null,
      errorCode: input.errorCode ?? null,
      statusCode: input.statusCode ?? null,
      summary: input.summary,
      requestPayload: serializeUnknown(input.requestPayload),
      responsePayload: serializeUnknown(input.responsePayload),
      runtimeContext: serializeUnknown(input.runtimeContext),
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    });
  });
  return reportId;
}

export async function getLatestRankSnapshot(agentId: string): Promise<number | null> {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const rows = await sql<{ rank: number | null }[]>`
      select rank
      from leaderboard_snapshots
      where agent_id = ${agentId}
      order by snapshot_at desc
      limit 1
    `;
    return rows[0]?.rank ?? null;
  }

  const store = readStore();
  const snapshot =
    store.leaderboardSnapshots
      .filter((item) => item.agentId === agentId)
      .sort((left, right) => right.snapshotAt.localeCompare(left.snapshotAt))[0] ?? null;
  return snapshot?.rank ?? null;
}

export async function writeLiveTradeEvent(input: {
  agentId: string;
  submissionId: string;
  actionId: string;
  competitionId: string | null;
  symbol: string;
  side: string;
  notionalUsd: number;
  positionRatio?: number | null;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  executedAt?: Date;
}) {
  const executedAt = input.executedAt ?? new Date();
  const rankSnapshot = await getLatestRankSnapshot(input.agentId);
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    await sql`
      insert into live_trade_events (
        id,
        competition_id,
        agent_id,
        submission_id,
        action_id,
        rank_snapshot,
        symbol,
        side,
        notional_usd,
        position_ratio,
        outcome_name,
        reason_tag,
        display_rationale,
        executed_at
      ) values (
        ${createId('live')},
        ${input.competitionId},
        ${input.agentId},
        ${input.submissionId},
        ${input.actionId},
        ${rankSnapshot},
        ${input.symbol},
        ${input.side},
        ${Math.round(input.notionalUsd * 100) / 100},
        ${
          input.positionRatio == null
            ? null
            : Math.round(input.positionRatio * 10000) / 10000
        },
        ${input.outcomeName ?? null},
        ${input.reasonTag ?? null},
        ${input.displayRationale?.slice(0, 400) ?? null},
        ${executedAt.toISOString()}
      )
    `;
    return;
  }

  await updateStore((store) => {
    store.liveTradeEvents.push({
      id: createId('live'),
      competitionId: input.competitionId ?? '',
      agentId: input.agentId,
      submissionId: input.submissionId,
      actionId: input.actionId,
      rankSnapshot,
      symbol: input.symbol,
      side: input.side.toLowerCase() === 'sell' ? 'sell' : 'buy',
      notionalUsd: Math.round(input.notionalUsd * 100) / 100,
      positionRatio:
        input.positionRatio == null
          ? null
          : Math.round(input.positionRatio * 10000) / 10000,
      outcomeName: input.outcomeName ?? null,
      reasonTag: input.reasonTag ?? null,
      displayRationale: input.displayRationale?.slice(0, 400) ?? null,
      executedAt: executedAt.toISOString(),
    });
  });
}

export async function writeRiskEvent(input: {
  agentId: string;
  competitionId: string | null;
  previousRiskTag: string | null;
  riskTag: string | null;
  cash: number;
  equity: number;
}) {
  const { previousRiskTag, riskTag } = input;
  if (!riskTag || riskTag === previousRiskTag) return;

  const thresholds: Record<string, { threshold: number; action: string }> = {
    high_risk: { threshold: 5000, action: 'Tagged as High Risk' },
    close_only: { threshold: 100, action: 'Close-only mode (no new buys)' },
    terminated: { threshold: 0, action: 'Agent terminated' },
  };
  const info = thresholds[riskTag] || { threshold: 0, action: riskTag };

  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    await sql`
      insert into risk_events (
        id,
        agent_id,
        competition_id,
        event_type,
        trigger_value,
        threshold_value,
        action_taken,
        resolved_at,
        created_at
      ) values (
        ${createId('risk')},
        ${input.agentId},
        ${input.competitionId},
        ${riskTag},
        ${riskTag === 'close_only' ? input.cash : input.equity},
        ${info.threshold},
        ${info.action},
        ${null},
        ${new Date().toISOString()}
      )
    `;
    return;
  }
}
