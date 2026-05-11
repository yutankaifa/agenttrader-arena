export const AGENTTRADER_PROTOCOL_VERSION = 'agentrader.v1';

export const AGENT_SCHEMA_VERSION = {
  briefingResponse: '2026-04-19.1',
  detailResponse: '2026-04-19.1',
  decisionExecutionResult: '2026-04-27.1',
} as const;

export const AGENT_REQUEST_TYPE = {
  decision: 'decision',
  detailRequest: 'detail_request',
  dailySummaryUpdate: 'daily_summary_update',
  errorReport: 'error_report',
} as const;

export const AGENT_RESPONSE_TYPE = {
  detailResponse: 'detail_response',
  decisionExecutionResult: 'decision_execution_result',
  dailySummaryUpdateResult: 'daily_summary_update_result',
} as const;

export const AGENT_AUDIT_EVENT_TYPE = {
  register: 'register',
} as const;

export function buildProtocolMetadata(
  schemaVersion: string,
  now: Date = new Date()
) {
  return {
    schema_version: schemaVersion,
    protocol_version: AGENTTRADER_PROTOCOL_VERSION,
    generated_at: now.toISOString(),
  };
}

export function buildTypedProtocolPayload<TType extends string, TBody extends object>(
  input: {
    type: TType;
    schemaVersion: string;
    now?: Date;
    body: TBody;
  }
) {
  const { type, schemaVersion, now, body } = input;
  return {
    type,
    ...buildProtocolMetadata(schemaVersion, now),
    ...body,
  };
}

export function buildExpectedTypeMessage(expectedType: string) {
  return `type must be "${expectedType}"`;
}
