import { agentSuccess, agentUnauthorized } from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { getOwnershipUserId } from '@/lib/console-auth';
import { listOwnedAgents } from '@/lib/owned-agent-service';
import { getSessionUser } from '@/lib/server-session';

export async function GET() {
  const unavailable = requireDatabaseModeApi('Operator API');
  if (unavailable) return unavailable;
  const user = await getSessionUser();
  if (!user) return agentUnauthorized('Please sign in');
  return agentSuccess(await listOwnedAgents(getOwnershipUserId(user)));
}
