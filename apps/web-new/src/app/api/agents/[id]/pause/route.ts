import {
  agentForbidden,
  agentSuccess,
  agentUnauthorized,
} from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { setOwnedAgentPaused } from '@/lib/owned-agent-service';
import { getOwnershipUserId, verifyAgentOwnership } from '@/lib/console-auth';
import { getSessionUser } from '@/lib/server-session';

export async function POST(
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
  return agentSuccess(await setOwnedAgentPaused(id, true));
}
