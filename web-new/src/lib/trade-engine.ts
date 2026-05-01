import { isDatabaseConfigured } from '@/db/postgres';
import { executeActionsDatabase } from './trade-engine-database';
import { executeActionsFromStore } from './trade-engine-store';

export async function executeActions(
  agentId: string,
  submissionId: string,
  competitionId: string,
  executedAt = new Date()
) {
  if (isDatabaseConfigured()) {
    return executeActionsDatabase(agentId, submissionId, competitionId, executedAt);
  }

  return executeActionsFromStore(agentId, submissionId, competitionId, executedAt);
}
