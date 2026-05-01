import { createId } from '@/db/id';
import {
  AGENT_REQUEST_TYPE,
  AGENT_RESPONSE_TYPE,
  buildExpectedTypeMessage,
} from '@/contracts/agent-protocol';
import { getSqlClient } from '@/db/postgres';
import { writeAgentErrorReport } from '@/lib/agent-events';
import {
  normalizeOptionalString,
  normalizeRequiredString,
  requireDatabaseMode,
} from '@/lib/agent-runtime-service-common';
import { normalizeWhitespace } from '@/lib/utils';

export async function upsertDailySummary(agentId: string, body: unknown) {
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
  if (payload.type != null && payload.type !== AGENT_REQUEST_TYPE.dailySummaryUpdate) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: buildExpectedTypeMessage(AGENT_REQUEST_TYPE.dailySummaryUpdate),
    };
  }
  if (payload.agent_id != null && payload.agent_id !== agentId) {
    return {
      ok: false as const,
      status: 403,
      code: 'FORBIDDEN',
      message: 'agent_id does not match the authenticated agent',
    };
  }

  const summaryDate = normalizeRequiredString(payload.summary_date, 'summary_date');
  if (!summaryDate.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: summaryDate.message,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(summaryDate.value)) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'summary_date must use YYYY-MM-DD',
    };
  }

  const summary = normalizeRequiredString(payload.summary, 'summary');
  if (!summary.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: summary.message,
    };
  }

  const normalizedSummary = normalizeWhitespace(summary.value);
  if (normalizedSummary.length < 20 || normalizedSummary.length > 1200) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'summary must be 20-1200 characters',
    };
  }

  const now = new Date().toISOString();
  let status: 'created' | 'updated' = 'created';
  const sql = getSqlClient();
  const existingRows = await sql<{ id: string }[]>`
    select id
    from agent_daily_summaries
    where agent_id = ${agentId}
      and summary_date = ${summaryDate.value}
    limit 1
  `;
  if (existingRows[0]) {
    status = 'updated';
    await sql`
      update agent_daily_summaries
      set
        summary = ${normalizedSummary},
        updated_at = ${now}
      where agent_id = ${agentId}
        and summary_date = ${summaryDate.value}
    `;
  } else {
    await sql`
      insert into agent_daily_summaries (
        id,
        agent_id,
        summary_date,
        summary,
        created_at,
        updated_at
      ) values (
        ${createId('daily')},
        ${agentId},
        ${summaryDate.value},
        ${normalizedSummary},
        ${now},
        ${now}
      )
    `;
  }

  return {
    ok: true as const,
    data: {
      type: AGENT_RESPONSE_TYPE.dailySummaryUpdateResult,
      agent_id: agentId,
      summary_date: summaryDate.value,
      status,
    },
  };
}

export async function recordAgentErrorReport(agentId: string, body: unknown) {
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
  if (payload.type != null && payload.type !== AGENT_REQUEST_TYPE.errorReport) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: buildExpectedTypeMessage(AGENT_REQUEST_TYPE.errorReport),
    };
  }

  const reportType =
    typeof payload.report_type === 'string'
      ? payload.report_type.trim().toLowerCase()
      : null;
  if (
    reportType !== 'api_error' &&
    reportType !== 'runtime_exception' &&
    reportType !== 'unexpected_result'
  ) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'report_type must be one of: api_error, runtime_exception, unexpected_result',
    };
  }

  const summary = normalizeRequiredString(payload.summary, 'summary');
  if (!summary.ok) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: summary.message,
    };
  }
  if (summary.value.length < 12 || summary.value.length > 1200) {
    return {
      ok: false as const,
      status: 400,
      code: 'BAD_REQUEST',
      message: 'summary must be 12-1200 characters',
    };
  }

  const normalizedSummary = summary.value;
  const sourceEndpoint = normalizeOptionalString(payload.source_endpoint);
  const httpMethod =
    typeof payload.http_method === 'string'
      ? payload.http_method.trim().toUpperCase() || null
      : null;
  const requestId = normalizeOptionalString(payload.request_id);
  const decisionId = normalizeOptionalString(payload.decision_id);
  const windowId = normalizeOptionalString(payload.window_id);
  const errorCode = normalizeOptionalString(payload.error_code);
  const statusCode =
    typeof payload.status_code === 'number' &&
    Number.isInteger(payload.status_code) &&
    payload.status_code >= 100 &&
    payload.status_code <= 599
      ? payload.status_code
      : null;
  const normalizeJsonPayload = (value: unknown) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || null;
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      Array.isArray(value) ||
      typeof value === 'object'
    ) {
      return value;
    }
    return String(value);
  };
  const createdAt = new Date();

  const reportId = await writeAgentErrorReport({
    agentId,
    reportType,
    sourceEndpoint,
    httpMethod,
    requestId,
    decisionId,
    windowId,
    errorCode,
    statusCode,
    summary: normalizedSummary,
    requestPayload: normalizeJsonPayload(payload.request_payload),
    responsePayload: normalizeJsonPayload(payload.response_payload),
    runtimeContext: normalizeJsonPayload(payload.runtime_context),
    createdAt,
  });

  return {
    ok: true as const,
    data: {
      type: 'error_report_result',
      report_id: reportId,
      report_type: reportType,
      created_at: createdAt.toISOString(),
      summary: normalizedSummary,
    },
  };
}
