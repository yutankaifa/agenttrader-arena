import { NextResponse } from 'next/server';
import type { AgentApiErrorBody, AgentApiSuccess } from 'agenttrader-types';

import { getBriefingWindowSeconds } from '@/lib/trading-rules';

type AgentUnexpectedErrorClassification = {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
};

type ErrorSignal = {
  name?: string;
  code?: string;
  message?: string;
};

const TIMEOUT_ERROR_CODES = new Set([
  'ABORT_ERR',
  'ETIMEDOUT',
  'ETIMEOUT',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

function readErrorSignal(value: unknown): ErrorSignal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

function collectErrorSignals(error: unknown, signals: ErrorSignal[] = []) {
  const signal = readErrorSignal(error);
  if (signal) {
    signals.push(signal);
  }

  if (error instanceof AggregateError) {
    for (const child of error.errors) {
      collectErrorSignals(child, signals);
    }
  }

  if (error && typeof error === 'object') {
    const cause = (error as { cause?: unknown }).cause;
    if (cause) {
      collectErrorSignals(cause, signals);
    }
  }

  return signals;
}

function errorSignalsContain(
  signals: ErrorSignal[],
  codes: Set<string>,
  patterns: RegExp[]
) {
  return signals.some((signal) => {
    if (signal.code && codes.has(signal.code)) {
      return true;
    }

    const searchable = [
      signal.name,
      signal.code,
      signal.message,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return patterns.some((pattern) => pattern.test(searchable));
  });
}

export function classifyAgentUnexpectedError(
  error: unknown,
  fallbackMessage: string
): AgentUnexpectedErrorClassification {
  const signals = collectErrorSignals(error);

  if (
    errorSignalsContain(signals, TIMEOUT_ERROR_CODES, [
      /\baborterror\b/,
      /\btime(?:d)?\s*out\b/,
      /\btimeout\b/,
      /\bheaders timeout\b/,
    ])
  ) {
    return {
      code: 'UPSTREAM_TIMEOUT',
      message: `${fallbackMessage}: a required service did not respond in time. Retry shortly.`,
      status: 504,
      details: {
        category: 'timeout',
        retry_hint: 'retry_with_backoff',
      },
    };
  }

  if (
    errorSignalsContain(signals, NETWORK_ERROR_CODES, [
      /\bconnection refused\b/,
      /\bconnection reset\b/,
      /\bdns\b/,
      /\benotfound\b/,
      /\bfetch failed\b/,
      /\bnetwork\b/,
      /\bnetwork unreachable\b/,
    ])
  ) {
    return {
      code: 'NETWORK_UNAVAILABLE',
      message: `${fallbackMessage}: a required service could not be reached. Retry shortly.`,
      status: 503,
      details: {
        category: 'network',
        retry_hint: 'retry_with_backoff',
      },
    };
  }

  if (
    errorSignalsContain(signals, TLS_ERROR_CODES, [
      /\bcertificate\b/,
      /\bssl\b/,
      /\btls\b/,
    ])
  ) {
    return {
      code: 'TLS_CONNECTION_ERROR',
      message: `${fallbackMessage}: a TLS connection check failed before the service could be used.`,
      status: 502,
      details: {
        category: 'tls',
        retry_hint: 'check_tls_or_retry_if_transient',
      },
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
    status: 500,
  };
}

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

export function agentUnexpectedError(error: unknown, fallbackMessage: string) {
  const classified = classifyAgentUnexpectedError(error, fallbackMessage);
  return agentError(
    classified.code,
    classified.message,
    classified.details,
    classified.status
  );
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
