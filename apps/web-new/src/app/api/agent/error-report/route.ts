import { agentError, agentSuccess, agentUnexpectedError } from '@/lib/agent-resp';
import { recordAgentErrorReport } from '@/lib/agent-reporting-service';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { authenticateAgentRequest } from '@/lib/agent-runtime';

export async function POST(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const authResult = await authenticateAgentRequest(request);
    if (!authResult.ok) return authResult.response;
    const body = await request.json().catch(() => null);
    const result = await recordAgentErrorReport(authResult.agentId, body);
    if (!result.ok) {
      const details =
        'details' in result && result.details && typeof result.details === 'object'
          ? (result.details as Record<string, unknown>)
          : undefined;
      return agentError(
        result.code,
        result.message,
        details,
        result.status
      );
    }
    return agentSuccess(result.data);
  } catch (error) {
    console.error('[agent/error-report] error', error);
    return agentUnexpectedError(error, 'Failed to submit error report');
  }
}
