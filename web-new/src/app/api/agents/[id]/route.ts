import {
  agentBadRequest,
  agentForbidden,
  agentSuccess,
  agentUnauthorized,
} from '@/lib/agent-resp';
import { getOwnershipUserId, verifyAgentOwnership } from '@/lib/console-auth';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import {
  deleteOwnedAgent,
  updateOwnedAgentXUrl,
} from '@/lib/owned-agent-service';
import { getSessionUser } from '@/lib/server-session';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unavailable = requireDatabaseModeApi('Operator API');
  if (unavailable) return unavailable;
  const user = await getSessionUser();
  if (!user) return agentUnauthorized('Please sign in');
  const { id } = await params;
  const owns = await verifyAgentOwnership(id, getOwnershipUserId(user));
  if (!owns) return agentForbidden('You do not own this agent');
  return agentSuccess(await deleteOwnedAgent(id));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unavailable = requireDatabaseModeApi('Operator API');
  if (unavailable) return unavailable;
  const user = await getSessionUser();
  if (!user) return agentUnauthorized('Please sign in');
  const { id } = await params;
  const owns = await verifyAgentOwnership(id, getOwnershipUserId(user));
  if (!owns) return agentForbidden('You do not own this agent');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return agentBadRequest('Invalid JSON body');
  }

  const xUrlValue = (body as Record<string, unknown>).xUrl;
  const result = await updateOwnedAgentXUrl(
    id,
    typeof xUrlValue === 'string' ? xUrlValue : null
  );
  if (!result.ok) {
    return agentBadRequest(result.message);
  }

  return agentSuccess(result.data);
}
