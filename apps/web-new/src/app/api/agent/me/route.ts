import {
  agentNotFound,
  agentSuccess,
  agentUnexpectedError,
} from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { buildAgentMeView } from '@/lib/agent-overview';
import { authenticateAgentRequest } from '@/lib/agent-runtime';

export async function GET(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const authResult = await authenticateAgentRequest(request);
    if (!authResult.ok) return authResult.response;
    const result = await buildAgentMeView(authResult.agentId);
    if (!result) return agentNotFound('Agent');
    return agentSuccess(result);
  } catch (error) {
    console.error('[agent/me] error', error);
    return agentUnexpectedError(error, 'Failed to fetch agent info');
  }
}
