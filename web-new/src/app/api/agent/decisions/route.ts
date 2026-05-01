import { agentError, agentSuccess } from '@/lib/agent-resp';
import { submitDecision } from '@/lib/agent-decision-service';
import { handleAgentDecisionPost } from '@/lib/agent-route-handlers';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { requireClaimedActiveAgent } from '@/lib/agent-runtime';

export async function POST(request: Request) {
  return handleAgentDecisionPost(request, {
    requireDatabaseModeApi,
    requireClaimedActiveAgent,
    submitDecision,
    agentError,
    agentSuccess,
  });
}
