type DecisionPersistenceActionInput = {
  action_id: string;
  side: 'buy' | 'sell';
  market: string;
  symbol: string;
  object_id: string;
  amount_usd: number;
  reason_tag: string;
  reasoning_summary: string;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
};

type IdFactory = (prefix: 'sub' | 'action' | 'detail') => string;

type DecisionPersistenceStatus = 'accepted' | 'rejected';

export function buildDecisionPersistencePlan(input: {
  createId: IdFactory;
  decisionId: string;
  agentId: string;
  competitionId: string;
  decisionRationale: string;
  windowId: string;
  status: DecisionPersistenceStatus;
  rejectionReason: string | null;
  receivedAt: string;
  actions: DecisionPersistenceActionInput[];
}) {
  const submissionId = input.createId('sub');
  const primaryAction = input.actions[0];
  const actionStatus = input.status === 'accepted' ? 'pending' : 'rejected';

  return {
    submission: {
      id: submissionId,
      decision_id: input.decisionId,
      agent_id: input.agentId,
      competition_id: input.competitionId,
      decision_rationale: input.decisionRationale,
      fallback_reasoning_summary:
        primaryAction?.reasoning_summary ?? input.decisionRationale,
      reason_tag:
        primaryAction?.reason_tag ??
        (input.status === 'accepted' ? 'decision' : 'rejected decision'),
      briefing_window_id: input.windowId,
      status: input.status,
      rejection_reason: input.rejectionReason,
      received_at: input.receivedAt,
    },
    actions: input.actions.map((action) => ({
      id: input.createId('action'),
      submission_id: submissionId,
      client_action_id: action.action_id,
      symbol: action.symbol,
      object_id: action.object_id,
      side: action.side,
      requested_units: 0,
      amount_usd: action.amount_usd,
      market: action.market,
      event_id: action.event_id,
      outcome_id: action.outcome_id,
      outcome_name: action.outcome_name,
      reason_tag: action.reason_tag,
      display_rationale: action.reasoning_summary,
      order_type: 'market',
      status: actionStatus,
      rejection_reason: input.rejectionReason,
    })),
  };
}

export function summarizeDecisionExecution(input: {
  actions: Array<{
    status: string;
    rejection_reason: string | null;
  }>;
}) {
  const hasPortfolioChange = input.actions.some(
    (item) => item.status === 'filled' || item.status === 'partial'
  );
  const executionStatus = hasPortfolioChange
    ? input.actions.some((item) => item.status === 'partial')
      ? 'partial'
      : 'executed'
    : 'rejected';

  return {
    portfolioChanged: hasPortfolioChange,
    executionStatus,
    submissionStatus: hasPortfolioChange ? 'accepted' : 'rejected',
    rejectionReason: hasPortfolioChange
      ? null
      : (input.actions[0]?.rejection_reason ?? 'NOT_EXECUTED'),
  };
}

export function buildDetailRequestPersistenceRow(input: {
  createId: IdFactory;
  agentId: string;
  competitionId: string;
  requestId: string;
  decisionWindowStart: string;
  briefingWindowId: string;
  requestReason: string;
  objectsRequested: string[];
  symbolsRequested: string[];
  responseSummary: string;
  requestedAt: string;
}) {
  return {
    id: input.createId('detail'),
    agent_id: input.agentId,
    competition_id: input.competitionId,
    request_id: input.requestId,
    decision_window_start: input.decisionWindowStart,
    briefing_window_id: input.briefingWindowId,
    request_reason: input.requestReason,
    objects_requested: JSON.stringify(input.objectsRequested),
    symbols_requested: JSON.stringify(input.symbolsRequested),
    response_summary: input.responseSummary,
    requested_at: input.requestedAt,
  };
}
