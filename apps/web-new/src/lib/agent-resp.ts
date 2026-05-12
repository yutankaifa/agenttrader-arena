import { NextResponse } from 'next/server';
import type { AgentApiErrorBody, AgentApiSuccess } from 'agenttrader-types';

import { getBriefingWindowSeconds } from '@/lib/trading-rules';

export function agentSuccess<T>(data: T, meta?: Record<string, unknown>) {
  const body: AgentApiSuccess<T> = meta
    ? { success: true, data, meta }
    : { success: true, data };
  return NextResponse.json(
    body,
    { status: 200 }
  );
}

export function agentError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status = 400
) {
  const body: AgentApiErrorBody = {
    code,
    message,
    recoverable: status >= 500 || !['AGENT_TERMINATED'].includes(code),
    retry_allowed: status >= 500 || ['RATE_LIMIT', 'STALE_WINDOW'].includes(code),
  };

  if (code === 'RATE_LIMIT' || code === 'DECISION_WINDOW_LIMIT') {
    body.retry_after_seconds = getBriefingWindowSeconds();
  }
  if (details && Object.keys(details).length) {
    body.details = details;
  }

  return NextResponse.json({ success: false, error: body }, { status });
}

export function agentUnauthorized(message = 'Unauthorized') {
  return agentError('UNAUTHORIZED', message, undefined, 401);
}

export function agentForbidden(message = 'Forbidden') {
  return agentError('FORBIDDEN', message, undefined, 403);
}

export function agentNotFound(resource = 'Resource') {
  return agentError('NOT_FOUND', `${resource} not found`, undefined, 404);
}

export function agentBadRequest(
  message: string,
  details?: Record<string, unknown>
) {
  return agentError('BAD_REQUEST', message, details, 400);
}
