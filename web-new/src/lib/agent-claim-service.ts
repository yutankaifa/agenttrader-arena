import { getSqlClient } from '@/db/postgres';
import { buildAgentMeView } from '@/lib/agent-overview';
import { writeAuditEvent } from '@/lib/agent-events';
import { ensureAgentXUrlColumn } from '@/lib/agent-x';
import { envConfigs } from '@/lib/env';
import {
  COMPETITION_PHASE,
} from '@/lib/trading-rules';
import {
  requireDatabaseMode,
  toIsoValue,
} from '@/lib/agent-runtime-service-common';

export async function claimAgent(userId: string, claimToken: string) {
  requireDatabaseMode();
  await ensureAgentXUrlColumn();
  const token = claimToken.toUpperCase().trim();
  const sql = getSqlClient();
  const claims = await sql<
    {
      id: string;
      agent_id: string;
      claimed_by: string | null;
      claimed_at: string | Date | null;
      status: string;
    }[]
  >`
    select id, agent_id, claimed_by, claimed_at, status
    from agent_claims
    where claim_token = ${token}
    limit 1
  `;
  const claim = claims[0];
  if (!claim) {
    return {
      ok: false as const,
      code: 'CLAIM_NOT_FOUND',
      status: 404,
      message: 'Claim token not found',
    };
  }

  if (claim.status === 'claimed' && claim.claimed_by === userId) {
    return {
      ok: false as const,
      code: 'ALREADY_CLAIMED',
      status: 400,
      message: 'You have already claimed this agent',
    };
  }

  if (claim.status === 'claimed') {
    return {
      ok: false as const,
      code: 'CLAIM_ALREADY_TAKEN',
      status: 400,
      message: 'This agent has already been claimed by another user',
    };
  }

  if (COMPETITION_PHASE === 'official') {
    const claimedRows = await sql<{ total: number }[]>`
      select count(*)::int as total
      from agent_claims
      where claimed_by = ${userId}
        and status = 'claimed'
    `;
    if (Number(claimedRows[0]?.total ?? 0) >= 1) {
      return {
        ok: false as const,
        code: 'OFFICIAL_AGENT_LIMIT_REACHED',
        status: 409,
        message: 'Official competition allows only one claimed agent per user.',
      };
    }
  }

  const agents = await sql<
    {
      id: string;
      name: string;
      runtime_environment: string | null;
      primary_market: string | null;
      claim_status: string | null;
      status: string;
      profile_completed_at: string | Date | null;
    }[]
  >`
    select
      id,
      name,
      runtime_environment,
      primary_market,
      claim_status,
      status,
      profile_completed_at
    from agents
    where id = ${claim.agent_id}
    limit 1
  `;
  const agent = agents[0];
  if (!agent) {
    return {
      ok: false as const,
      code: 'NOT_FOUND',
      status: 404,
      message: 'Agent not found',
    };
  }

  if (!agent.profile_completed_at) {
    return {
      ok: false as const,
      code: 'AGENT_PROFILE_INCOMPLETE',
      status: 409,
      message: 'Complete initialization config before claim.',
    };
  }

  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    await tx`
      update agent_claims
      set
        claimed_by = ${userId},
        claimed_at = ${now},
        status = 'claimed'
      where id = ${claim.id}
    `;
    await tx`
      update agents
      set
        claim_status = 'claimed',
        status = case when status = 'registered' then 'active' else status end,
        updated_at = ${now}
      where id = ${agent.id}
    `;
  });

  await writeAuditEvent({
    agentId: agent.id,
    eventType: 'claim',
    payload: { userId, claimToken: token },
  });

  const appUrl = envConfigs.appUrl.replace(/\/$/, '');
  return {
    ok: true as const,
    data: {
      agent_id: agent.id,
      agent_name: agent.name,
      runtime_environment: agent.runtime_environment,
      primary_market: agent.primary_market,
      activation: {
        claim_status: 'claimed',
        status: agent.status === 'registered' ? 'active' : agent.status,
        activated: true,
        activated_at: now,
      },
      next_steps: {
        heartbeat_guide_url: `${appUrl}/skill/heartbeat.md`,
        runtime_guide_url: `${appUrl}/skill/heartbeat.md`,
        heartbeat_ping_url: `${appUrl}/api/openclaw/agents/heartbeat-ping`,
        skill_url: `${appUrl}/skill.md`,
      },
      message: 'Agent successfully claimed and activated.',
    },
  };
}

export async function getClaimTokenView(token: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      agent_id: string;
      agent_name: string;
      agent_description: string | null;
      agent_status: string;
      claim_status: string | null;
      agent_created_at: string | Date | null;
      claim_token: string;
      claim_status_row: string;
      claimed_by: string | null;
      claimed_at: string | Date | null;
    }[]
  >`
    select
      a.id as agent_id,
      a.name as agent_name,
      a.description as agent_description,
      a.status as agent_status,
      a.claim_status,
      a.created_at as agent_created_at,
      c.claim_token,
      c.status as claim_status_row,
      c.claimed_by,
      c.claimed_at
    from agent_claims c
    inner join agents a on a.id = c.agent_id
    where c.claim_token = ${token.toUpperCase()}
    limit 1
  `;
  const row = rows[0] ?? null;
  if (!row) return null;

  return {
    agent: {
      id: row.agent_id,
      name: row.agent_name,
      description: row.agent_description,
      status: row.agent_status,
      claim_status: row.claim_status,
      created_at: toIsoValue(row.agent_created_at),
    },
    claim: {
      token: row.claim_token,
      status: row.claim_status_row,
      claimed_by: row.claimed_by,
      claimed_at: toIsoValue(row.claimed_at),
    },
  };
}

export async function getPendingClaimToken() {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      claim_token: string;
      claim_url: string | null;
      agent_id: string;
      agent_name: string | null;
    }[]
  >`
    select
      c.claim_token,
      c.claim_url,
      c.agent_id,
      a.name as agent_name
    from agent_claims c
    left join agents a on a.id = c.agent_id
    where c.status = 'pending'
      and c.claimed_by is null
    order by c.agent_id asc
    limit 1
  `;
  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    token: row.claim_token,
    claimUrl: row.claim_url,
    agentId: row.agent_id,
    agentName: row.agent_name,
  };
}

export async function buildClaimPageData(token: string) {
  requireDatabaseMode();
  const claim = await getClaimTokenView(token);
  if (!claim) return null;
  const agent = await buildAgentMeView(claim.agent.id);
  return {
    claim,
    agent,
  };
}
