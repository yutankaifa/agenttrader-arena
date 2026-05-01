import type { Sql, TransactionSql } from 'postgres';

type SqlTemplateExecutor = Sql | TransactionSql;
type SqlTransactionExecutor = Sql;

type DecisionSubmissionRow = {
  id: string;
  decision_id: string;
  agent_id: string;
  competition_id: string;
  decision_rationale: string;
  fallback_reasoning_summary: string;
  reason_tag: string;
  briefing_window_id: string;
  status: string;
  rejection_reason: string | null;
  received_at: string;
};

type DecisionActionRow = {
  id: string;
  submission_id: string;
  client_action_id: string;
  symbol: string;
  object_id: string;
  side: 'buy' | 'sell';
  requested_units: number;
  amount_usd: number;
  market: string;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
  reason_tag: string;
  display_rationale: string;
  order_type: string;
  status: string;
  rejection_reason: string | null;
};

type DecisionPersistencePlan = {
  submission: DecisionSubmissionRow;
  actions: DecisionActionRow[];
};

type DetailRequestPersistenceRow = {
  id: string;
  agent_id: string;
  competition_id: string;
  request_id: string;
  decision_window_start: string;
  briefing_window_id: string;
  request_reason: string;
  objects_requested: string;
  symbols_requested: string;
  response_summary: string;
  requested_at: string;
};

export async function writeDecisionPersistencePlan(
  sql: SqlTransactionExecutor,
  plan: DecisionPersistencePlan
) {
  await sql.begin(async (tx) => {
    if (plan.submission.briefing_window_id) {
      await tx`
        insert into decision_window_consumptions (
          agent_id,
          briefing_window_id,
          submission_id,
          decision_id,
          status,
          rejection_reason,
          consumed_at
        ) values (
          ${plan.submission.agent_id},
          ${plan.submission.briefing_window_id},
          ${plan.submission.id},
          ${plan.submission.decision_id},
          ${plan.submission.status},
          ${plan.submission.rejection_reason},
          ${plan.submission.received_at}
        )
      `;
    }

    await tx`
      insert into decision_submissions (
        id,
        decision_id,
        agent_id,
        competition_id,
        decision_rationale,
        fallback_reasoning_summary,
        reasoning_summary,
        reason_tag,
        briefing_window_id,
        status,
        rejection_reason,
        received_at
      ) values (
        ${plan.submission.id},
        ${plan.submission.decision_id},
        ${plan.submission.agent_id},
        ${plan.submission.competition_id},
        ${plan.submission.decision_rationale},
        ${plan.submission.fallback_reasoning_summary},
        ${plan.submission.fallback_reasoning_summary},
        ${plan.submission.reason_tag},
        ${plan.submission.briefing_window_id},
        ${plan.submission.status},
        ${plan.submission.rejection_reason},
        ${plan.submission.received_at}
      )
    `;

    for (const action of plan.actions) {
      await tx`
        insert into decision_actions (
          id,
          submission_id,
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
          order_type,
          status,
          rejection_reason
        ) values (
          ${action.id},
          ${action.submission_id},
          ${action.client_action_id},
          ${action.symbol},
          ${action.object_id},
          ${action.side},
          ${action.requested_units},
          ${action.amount_usd},
          ${action.market},
          ${action.event_id},
          ${action.outcome_id},
          ${action.outcome_name},
          ${action.reason_tag},
          ${action.display_rationale},
          ${action.order_type},
          ${action.status},
          ${action.rejection_reason}
        )
      `;
    }
  });
}

export async function updateDecisionSubmissionExecutionResult(
  sql: SqlTemplateExecutor,
  input: {
    submissionId: string;
    status: string;
    rejectionReason: string | null;
  }
) {
  await sql`
    update decision_submissions
    set
      status = ${input.status},
      rejection_reason = ${input.rejectionReason}
    where id = ${input.submissionId}
  `;
  await sql`
    update decision_window_consumptions
    set
      status = ${input.status},
      rejection_reason = ${input.rejectionReason}
    where submission_id = ${input.submissionId}
  `;
}

export async function writeDetailRequestPersistenceRow(
  sql: SqlTemplateExecutor,
  row: DetailRequestPersistenceRow
) {
  await sql`
    insert into detail_requests (
      id,
      agent_id,
      competition_id,
      request_id,
      decision_window_start,
      briefing_window_id,
      request_reason,
      objects_requested,
      symbols_requested,
      response_summary,
      requested_at
    ) values (
      ${row.id},
      ${row.agent_id},
      ${row.competition_id},
      ${row.request_id},
      ${row.decision_window_start},
      ${row.briefing_window_id},
      ${row.request_reason},
      ${row.objects_requested},
      ${row.symbols_requested},
      ${row.response_summary},
      ${row.requested_at}
    )
  `;
}

export function isDecisionWindowConsumptionConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: string;
    constraint?: string;
    message?: string;
  };
  return (
    candidate.code === '23505' &&
    (candidate.constraint === 'decision_window_consumptions_pkey' ||
      (typeof candidate.message === 'string' &&
        candidate.message.includes('decision_window_consumptions')))
  );
}
