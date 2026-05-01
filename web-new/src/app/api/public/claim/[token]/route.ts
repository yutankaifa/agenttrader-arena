import { readStore } from '@/db/store';
import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { getClaimTokenView } from '@/lib/agent-claim-service';
import { isPostgresBackedMode } from '@/lib/database-mode';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!isPostgresBackedMode()) {
    const normalizedToken = token.toUpperCase();
    const store = readStore();
    const claim = store.agentClaims.find((item) => item.claimToken === normalizedToken);
    const agent = claim
      ? store.agents.find((item) => item.id === claim.agentId)
      : null;

    if (!claim || !agent) {
      return agentNotFound('Claim token');
    }

    return agentSuccess({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        claim_status: agent.claimStatus,
        created_at: agent.createdAt,
      },
      claim: {
        token: claim.claimToken,
        status: claim.status,
      },
    });
  }

  const result = await getClaimTokenView(token);
  if (!result) return agentNotFound('Claim token');

  return agentSuccess({
    agent: result.agent,
    claim: {
      token: result.claim.token,
      status: result.claim.status,
    },
  });
}
