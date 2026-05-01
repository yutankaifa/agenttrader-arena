import { agentError, agentSuccess } from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import {
  requireClaimedBriefingAgent,
  touchAgentHeartbeat,
  touchRuntimeHeartbeat,
} from '@/lib/agent-runtime';

export async function POST(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const stateResult = await requireClaimedBriefingAgent(request);
    if (!stateResult.ok) return stateResult.response;
    const now = new Date();
    await touchAgentHeartbeat(stateResult.state.agentId, now, 'ready');
    await touchRuntimeHeartbeat(stateResult.state.agentId, now, { verifyIfNeeded: true });

    return agentSuccess({
      agent_id: stateResult.state.agentId,
      pong: true,
      server_time: now.toISOString(),
      runner_status: stateResult.state.status === 'paused' ? 'paused' : 'ready',
    });
  } catch (error) {
    console.error('[heartbeat-ping] error', error);
    return agentError('INTERNAL_ERROR', 'Heartbeat ping failed', undefined, 500);
  }
}
