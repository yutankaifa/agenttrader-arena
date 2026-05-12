export const MARKET_TYPES = ['stock', 'crypto', 'prediction']

export function isMarketType(value) {
  return MARKET_TYPES.includes(value)
}

export const AGENTTRADER_PROTOCOL_VERSION = 'agentrader.v1'

export const AGENT_SCHEMA_VERSION = {
  briefingResponse: '2026-04-19.1',
  detailResponse: '2026-04-19.1',
  decisionExecutionResult: '2026-04-27.1',
}

export const AGENT_REQUEST_TYPE = {
  decision: 'decision',
  detailRequest: 'detail_request',
  dailySummaryUpdate: 'daily_summary_update',
  errorReport: 'error_report',
}

export const AGENT_RESPONSE_TYPE = {
  detailResponse: 'detail_response',
  decisionExecutionResult: 'decision_execution_result',
  dailySummaryUpdateResult: 'daily_summary_update_result',
}

export const AGENT_AUDIT_EVENT_TYPE = {
  register: 'register',
}

export function buildProtocolMetadata(schemaVersion, now = new Date()) {
  return {
    schema_version: schemaVersion,
    protocol_version: AGENTTRADER_PROTOCOL_VERSION,
    generated_at: now.toISOString(),
  }
}

export function buildTypedProtocolPayload(input) {
  const { type, schemaVersion, now, body } = input
  return {
    type,
    ...buildProtocolMetadata(schemaVersion, now),
    ...body,
  }
}

export function buildExpectedTypeMessage(expectedType) {
  return `type must be "${expectedType}"`
}

export const QUOTE_KEY_PREFIX = 'market:quote:'
export const QUOTE_SYMBOL_LIST_PREFIX = 'market:quotes:'
export const RECENT_SYMBOL_LIST_PREFIX = 'market:recent-symbols:'

export const WORKER_QUOTE_TTL_SECONDS = 180
export const WORKER_SYMBOL_LIST_TTL_SECONDS = 120

export function normalizeQuoteKeyPart(value) {
  return value.trim().toUpperCase()
}

function normalizeQuoteLookup(input) {
  if (typeof input === 'string') {
    return {
      symbol: input.trim(),
      market: null,
      outcomeId: null,
    }
  }

  return {
    symbol: input.symbol.trim(),
    market: input.market ?? null,
    outcomeId: input.outcomeId ?? null,
  }
}

export function quoteKey(input) {
  const normalized = normalizeQuoteLookup(input)
  const marketPart = normalized.market ? `${normalized.market}:` : ''
  let outcomePart = ''
  if (normalized.market === 'prediction' && normalized.outcomeId) {
    outcomePart = `:${normalizeQuoteKeyPart(normalized.outcomeId)}`
  }

  return `${QUOTE_KEY_PREFIX}${marketPart}${normalizeQuoteKeyPart(normalized.symbol)}${outcomePart}`
}

export function quoteSymbolListKey(marketType) {
  return `${QUOTE_SYMBOL_LIST_PREFIX}${marketType}`
}

export function recentQuoteSymbolListKey(marketType) {
  return `${RECENT_SYMBOL_LIST_PREFIX}${marketType}`
}
