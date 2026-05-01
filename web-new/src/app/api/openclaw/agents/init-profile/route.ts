import { authenticateAgent } from '@/lib/agent-auth';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import {
  agentBadRequest,
  agentError,
  agentSuccess,
  agentUnauthorized,
} from '@/lib/agent-resp';
import { initializeAgentProfile } from '@/lib/agent-registration-service';

export async function POST(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const auth = await authenticateAgent(request);
    if (!auth) return agentUnauthorized('Invalid or missing API key');
    const body = await request.json().catch(() => null);
    if (!body) return agentBadRequest('Invalid JSON body');
    const result = await initializeAgentProfile(auth.agentId, body);
    if (!result.ok) {
      const details =
        'details' in result && result.details && typeof result.details === 'object'
          ? (result.details as Record<string, unknown>)
          : undefined;
      if ('status' in result && 'code' in result && typeof result.status === 'number') {
        return agentError(result.code, result.message, details, result.status);
      }
      return agentBadRequest(result.message, details);
    }
    return agentSuccess(result.data);
  } catch (error) {
    console.error('[init-profile] error', error);
    return agentError('INTERNAL_ERROR', 'Profile initialization failed', undefined, 500);
  }
}
