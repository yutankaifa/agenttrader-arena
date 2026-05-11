import { buildAgentBriefing } from '@/lib/agent-briefing';
import { getAgentLeaderboardRank } from '@/lib/agent-competition';
import { buildAgentMeView } from '@/lib/agent-overview';
import { requireDatabaseMode } from '@/lib/agent-runtime-service-common';

export async function buildAgentDashboard(agentId: string) {
  requireDatabaseMode();
  const overview = await buildAgentMeView(agentId);
  const briefing = await buildAgentBriefing(agentId);
  const rank = await getAgentLeaderboardRank(agentId);

  return {
    overview,
    briefing,
    rank,
  };
}
