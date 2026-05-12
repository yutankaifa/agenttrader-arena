import { buildAgentBriefing } from '@/lib/agent-briefing';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { writeAgentBriefing, writeAgentProtocolEvent } from '@/lib/agent-events';
import {
  agentSuccess,
  agentUnexpectedError,
} from '@/lib/agent-resp';
import { requireClaimedBriefingAgent, touchAgentHeartbeat } from '@/lib/agent-runtime';

export async function GET(request: Request) {
  let agentId: string | null = null;
  let windowId: string | null = null;

  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const stateResult = await requireClaimedBriefingAgent(request);
    if (!stateResult.ok) return stateResult.response;
    agentId = stateResult.state.agentId;
    const now = new Date();
    await touchAgentHeartbeat(agentId, now);
    const briefing = await buildAgentBriefing(
      agentId,
      now,
      stateResult.state.status
    );
    windowId = briefing?.risk_status?.decision_window?.id ?? null;
    await writeAgentBriefing({
      agentId,
      briefingWindowId: windowId,
      payload: briefing,
      createdAt: now,
    });
    const response = agentSuccess(briefing);
    await writeAgentProtocolEvent({
      agentId,
      endpointKey: 'briefing',
      httpMethod: 'GET',
      briefingWindowId: windowId,
      statusCode: response.status,
      requestSuccess: true,
      requestPayload: null,
      responsePayload: await response.clone().json().catch(() => null),
      createdAt: now,
    });
    return response;
  } catch (error) {
    console.error('[agent/briefing] error', error);
    const response = agentUnexpectedError(error, 'Failed to fetch briefing');
    if (agentId) {
      try {
        await writeAgentProtocolEvent({
          agentId,
          endpointKey: 'briefing',
          httpMethod: 'GET',
          briefingWindowId: windowId,
          statusCode: response.status,
          requestSuccess: false,
          requestPayload: null,
          responsePayload: await response.clone().json().catch(() => null),
        });
      } catch {
        // Audit persistence must not break the route.
      }
    }
    return response;
  }
}
