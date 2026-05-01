import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { listPublicAgentPositions } from '@/lib/public-agent';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await listPublicAgentPositions(id);
  if (!result) return agentNotFound('Agent');
  return agentSuccess(result);
}
