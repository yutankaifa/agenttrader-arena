import { agentError, agentSuccess } from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import {
  authenticateAgentRequest,
  getAgentRuntimeState,
  recordRuntimeHeartbeatFailure,
  touchAgentHeartbeat,
  touchRuntimeHeartbeat,
} from '@/lib/agent-runtime';
import { writeAgentProtocolEvent } from '@/lib/agent-events';

export async function POST(request: Request) {
  let agentId: string | null = null;
  const now = new Date();

  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;

    const authResult = await authenticateAgentRequest(request);
    if (!authResult.ok) return authResult.response;
    agentId = authResult.agentId;

    const state = await getAgentRuntimeState(agentId);
    if (!state) {
      const response = agentError(
        'UNAUTHORIZED',
        'Invalid or missing API key',
        undefined,
        401
      );
      await recordHeartbeatFailure(agentId, now, {
        code: 'UNAUTHORIZED',
        message: 'Authenticated key did not resolve to an agent runtime row',
        statusCode: response.status,
        response,
      });
      return response;
    }

    if (state.claimStatus !== 'claimed') {
      const response = agentError(
        'FORBIDDEN',
        'Agent must be claimed before heartbeat',
        undefined,
        403
      );
      await recordHeartbeatFailure(agentId, now, {
        code: 'AGENT_NOT_CLAIMED',
        message: 'Agent must be claimed before heartbeat',
        statusCode: response.status,
        response,
      });
      return response;
    }

    if (state.status !== 'active' && state.status !== 'paused') {
      const response = agentError(
        'FORBIDDEN',
        'Agent must be active or paused',
        undefined,
        403
      );
      await recordHeartbeatFailure(agentId, now, {
        code: 'AGENT_NOT_ACTIVE',
        message: 'Agent must be active or paused',
        statusCode: response.status,
        response,
      });
      return response;
    }

    await touchAgentHeartbeat(agentId, now, 'ready');
    await touchRuntimeHeartbeat(agentId, now, { verifyIfNeeded: true });

    const response = agentSuccess({
      agent_id: agentId,
      pong: true,
      server_time: now.toISOString(),
      runner_status: state.status === 'paused' ? 'paused' : 'ready',
    });
    await writeHeartbeatProtocolEvent(agentId, response, true, now);
    return response;
  } catch (error) {
    console.error('[heartbeat-ping] error', error);
    const response = agentError('INTERNAL_ERROR', 'Heartbeat ping failed', undefined, 500);
    if (agentId) {
      await recordHeartbeatFailure(agentId, now, {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Heartbeat ping failed',
        statusCode: response.status,
        response,
      }).catch(() => undefined);
    }
    return response;
  }
}

async function recordHeartbeatFailure(
  agentId: string,
  now: Date,
  failure: {
    code: string;
    message: string;
    statusCode: number;
    response: Response;
  }
) {
  try {
    await recordRuntimeHeartbeatFailure(agentId, now, failure);
  } catch {
    // Diagnostics are best-effort and should not replace the original error.
  }
  await writeHeartbeatProtocolEvent(agentId, failure.response, false, now);
}

async function writeHeartbeatProtocolEvent(
  agentId: string,
  response: Response,
  requestSuccess: boolean,
  createdAt: Date
) {
  try {
    await writeAgentProtocolEvent({
      agentId,
      endpointKey: 'heartbeat_ping',
      httpMethod: 'POST',
      statusCode: response.status,
      requestSuccess,
      requestPayload: null,
      responsePayload: await response.clone().json().catch(() => null),
      createdAt,
    });
  } catch {
    // Heartbeat observability must not break the agent-facing API response.
  }
}
