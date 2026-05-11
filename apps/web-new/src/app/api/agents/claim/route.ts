import {
  agentBadRequest,
  agentError,
  agentSuccess,
  agentUnauthorized,
} from '@/lib/agent-resp';
import { claimAgent } from '@/lib/agent-claim-service';
import { getOwnershipUserId } from '@/lib/console-auth';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { getSessionUser } from '@/lib/server-session';

export async function POST(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Operator API');
    if (unavailable) return unavailable;
    const user = await getSessionUser();
    if (!user) return agentUnauthorized('Please sign in to claim an agent');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return agentBadRequest('Invalid JSON body');
    }

    const claimToken = (body as Record<string, unknown>).claim_token;
    if (typeof claimToken !== 'string' || !claimToken.trim()) {
      return agentBadRequest('claim_token is required');
    }

    const result = await claimAgent(getOwnershipUserId(user), claimToken);
    if (!result.ok) {
      const details =
        'details' in result && result.details && typeof result.details === 'object'
          ? (result.details as Record<string, unknown>)
          : undefined;
      return agentError(result.code, result.message, details, result.status);
    }
    return agentSuccess(result.data);
  } catch (error) {
    console.error('[claim] error:', error);
    return agentError('INTERNAL_ERROR', 'Claim failed', undefined, 500);
  }
}
