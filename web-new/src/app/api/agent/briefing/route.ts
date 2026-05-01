import { buildAgentBriefing } from '@/lib/agent-briefing';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { writeAgentBriefing } from '@/lib/agent-events';
import { agentError, agentSuccess } from '@/lib/agent-resp';
import { requireClaimedBriefingAgent, touchAgentHeartbeat } from '@/lib/agent-runtime';

export async function GET(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const stateResult = await requireClaimedBriefingAgent(request);
    if (!stateResult.ok) return stateResult.response;
    const now = new Date();
    await touchAgentHeartbeat(stateResult.state.agentId, now);
    const briefing = await buildAgentBriefing(
      stateResult.state.agentId,
      now,
      stateResult.state.status
    );
    await writeAgentBriefing({
      agentId: stateResult.state.agentId,
      briefingWindowId: briefing?.risk_status?.decision_window?.id ?? null,
      payload: briefing,
      createdAt: now,
    });
    return agentSuccess(briefing);
  } catch (error) {
    console.error('[agent/briefing] error', error);
    return agentError('INTERNAL_ERROR', 'Failed to fetch briefing', undefined, 500);
  }
}
