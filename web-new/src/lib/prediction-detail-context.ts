import { getSqlClient } from '@/db/postgres';
import {
  evaluatePredictionDecisionContext,
  type PredictionDecisionAction,
  type PredictionDecisionContextCheck,
} from '@/lib/prediction-detail-contract';

export async function validatePredictionDecisionContext(
  agentId: string,
  windowId: string,
  actions: PredictionDecisionAction[]
): Promise<PredictionDecisionContextCheck | null> {
  const predictionActions = actions.filter((item) => item.market === 'prediction');
  if (!predictionActions.length) {
    return null;
  }

  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      requested_at: string | Date | null;
      response_summary: string | null;
    }[]
  >`
    select id, requested_at, response_summary
    from detail_requests
    where agent_id = ${agentId}
      and briefing_window_id = ${windowId}
    order by requested_at desc
    limit 1
  `;

  return evaluatePredictionDecisionContext({
    latestRequest: rows[0] ?? null,
    windowId,
    actions,
  });
}
