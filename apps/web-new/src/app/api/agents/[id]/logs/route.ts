import {
  agentForbidden,
  agentSuccess,
  agentUnauthorized,
} from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { listOwnedAgentLogs } from '@/lib/owned-agent-service';
import { getOwnershipUserId, verifyAgentOwnership } from '@/lib/console-auth';
import { getSessionUser } from '@/lib/server-session';
import { parseNumberParam } from '@/lib/utils';

export async function GET(
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
  const url = new URL(request.url);
  const page = Math.max(1, parseNumberParam(url.searchParams.get('page'), 1));
  const pageSize = Math.min(
    50,
    Math.max(1, parseNumberParam(url.searchParams.get('pageSize'), 20))
  );
  const status = url.searchParams.get('status') || 'all';
  const result = await listOwnedAgentLogs({ agentId: id, page, pageSize, status });
  return agentSuccess(result.items, result.meta);
}
