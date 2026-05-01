import { agentError, agentSuccess } from '@/lib/agent-resp';
import { submitDetailRequest } from '@/lib/agent-detail-request-service';
import { handleAgentDetailRequestPost } from '@/lib/agent-route-handlers';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { authenticateAgentRequest } from '@/lib/agent-runtime';

export async function POST(request: Request) {
  return handleAgentDetailRequestPost(request, {
    requireDatabaseModeApi,
    authenticateAgentRequest,
    submitDetailRequest,
    agentError,
    agentSuccess,
  });
}
