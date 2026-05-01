import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { authenticateAgent } from '@/lib/agent-auth';

function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent runtime');
  }
}

async function buildAgentUnauthorized(message: string) {
  const { agentUnauthorized } = await import('@/lib/agent-resp');
  return agentUnauthorized(message);
}

async function buildAgentForbidden(message: string) {
  const { agentForbidden } = await import('@/lib/agent-resp');
  return agentForbidden(message);
}

export async function authenticateAgentRequest(request: Request) {
  const auth = await authenticateAgent(request);
  if (!auth) {
    return {
      ok: false as const,
      response: await buildAgentUnauthorized('Invalid or missing API key'),
    };
  }

  return { ok: true as const, agentId: auth.agentId };
}

export async function getAgentRuntimeState(agentId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      status: string;
      claim_status: string | null;
      last_heartbeat_at: string | Date | null;
      runner_status: string | null;
      verified_at: string | Date | null;
    }[]
  >`
    select
      a.id,
      a.status,
      a.claim_status,
      a.last_heartbeat_at,
      a.runner_status,
      rc.verified_at
    from agents a
    left join runtime_configs rc on rc.agent_id = a.id
    where a.id = ${agentId}
    limit 1
  `;
  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    agentId: row.id,
    status: row.status,
    claimStatus: row.claim_status,
    lastHeartbeatAt:
      row.last_heartbeat_at instanceof Date
        ? row.last_heartbeat_at.toISOString()
        : row.last_heartbeat_at,
    runnerStatus: row.runner_status ?? 'idle',
    operatorPaused: row.status === 'paused',
    runtimeVerifiedAt:
      row.verified_at instanceof Date ? row.verified_at.toISOString() : row.verified_at,
  };
}

export async function touchAgentHeartbeat(
  agentId: string,
  now = new Date(),
  runnerStatus: 'ready' | 'running' | 'idle' | 'error' = 'ready'
) {
  requireDatabaseMode();
  const sql = getSqlClient();
  await sql`
    update agents
    set
      last_heartbeat_at = ${now.toISOString()},
      runner_status = ${runnerStatus},
      status = case
        when status = 'registered' and claim_status = 'claimed' then 'active'
        else status
      end,
      updated_at = ${now.toISOString()}
    where id = ${agentId}
  `;
  return { id: agentId };
}

export async function touchRuntimeHeartbeat(
  agentId: string,
  now = new Date(),
  options?: { verifyIfNeeded?: boolean }
) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<{ verified_at: string | Date | null }[]>`
    select verified_at
    from runtime_configs
    where agent_id = ${agentId}
    limit 1
  `;
  if (!rows[0]) {
    return null;
  }

  if (options?.verifyIfNeeded && !rows[0].verified_at) {
    await sql`
      update runtime_configs
      set
        last_heartbeat_at = ${now.toISOString()},
        verified_at = ${now.toISOString()}
      where agent_id = ${agentId}
    `;
    return { agentId };
  }

  await sql`
    update runtime_configs
    set last_heartbeat_at = ${now.toISOString()}
    where agent_id = ${agentId}
  `;
  return { agentId };
}

export async function requireClaimedBriefingAgent(request: Request) {
  const authResult = await authenticateAgentRequest(request);
  if (!authResult.ok) return authResult;

  const state = await getAgentRuntimeState(authResult.agentId);
  if (!state) {
    return {
      ok: false as const,
      response: await buildAgentUnauthorized('Invalid or missing API key'),
    };
  }
  if (state.claimStatus !== 'claimed') {
    return {
      ok: false as const,
      response: await buildAgentForbidden('Agent must be claimed before briefing'),
    };
  }
  if (state.status !== 'active' && state.status !== 'paused') {
    return {
      ok: false as const,
      response: await buildAgentForbidden('Agent must be active or paused'),
    };
  }

  return { ok: true as const, state };
}

export async function requireClaimedActiveAgent(request: Request) {
  const stateResult = await requireClaimedBriefingAgent(request);
  if (!stateResult.ok) return stateResult;

  if (stateResult.state.status === 'paused') {
    return {
      ok: false as const,
      response: await buildAgentForbidden('Agent is paused by operator'),
    };
  }

  return stateResult;
}
