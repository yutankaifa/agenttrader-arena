import { agentError, agentSuccess, agentUnexpectedError } from '@/lib/agent-resp';
import { upsertDailySummary } from '@/lib/agent-reporting-service';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { requireClaimedActiveAgent } from '@/lib/agent-runtime';

export async function POST(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const stateResult = await requireClaimedActiveAgent(request);
    if (!stateResult.ok) return stateResult.response;
    const body = await request.json().catch(() => null);
    const result = await upsertDailySummary(stateResult.state.agentId, body);
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
    console.error('[agent/daily-summary-update] error', error);
    return agentUnexpectedError(error, 'Daily summary update failed');
  }
}
