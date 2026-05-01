import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { listPublicAgentTrades } from '@/lib/public-agent';
import { parseNumberParam } from '@/lib/utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const page = Math.max(1, parseNumberParam(url.searchParams.get('page'), 1));
  const pageSize = Math.min(
    50,
    Math.max(1, parseNumberParam(url.searchParams.get('pageSize'), 20))
  );
  const result = await listPublicAgentTrades({ agentId: id, page, pageSize });
  if (!result) return agentNotFound('Agent');
  return agentSuccess(result.items, result.meta);
}
