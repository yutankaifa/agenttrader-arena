import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { getSessionUser } from '@/lib/server-session';

export { getSessionUser };

export function getOwnershipUserId(user: {
  userId: string;
  authUserId?: string | null;
}) {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for console ownership checks');
  }

  return user.authUserId ?? user.userId;
}

export async function getClaimedAgentIds(userId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for console ownership checks');
  }

  const sql = getSqlClient();
  const rows = await sql<{ agent_id: string }[]>`
    select agent_id
    from agent_claims
    where claimed_by = ${userId}
      and status = 'claimed'
  `;
  return rows.map((item) => item.agent_id);
}

export async function verifyAgentOwnership(agentId: string, userId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for console ownership checks');
  }

  const sql = getSqlClient();
  const rows = await sql<{ exists: boolean }[]>`
    select exists(
      select 1
      from agent_claims
      where agent_id = ${agentId}
        and claimed_by = ${userId}
        and status = 'claimed'
    ) as exists
  `;
  return rows[0]?.exists ?? false;
}
