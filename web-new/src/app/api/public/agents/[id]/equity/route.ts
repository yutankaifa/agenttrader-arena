import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { getPublicAgentEquity } from '@/lib/public-agent';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '1d';
  const result = await getPublicAgentEquity({ agentId: id, range });
  if (!result) return agentNotFound('Agent');
  return agentSuccess(result);
}
