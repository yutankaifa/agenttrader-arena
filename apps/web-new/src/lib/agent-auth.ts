import { createHash, randomBytes } from 'crypto';

import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';

const CLAIM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateApiKey() {
  return `at_${randomBytes(24).toString('hex')}`;
}

export function hashApiKey(rawKey: string) {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function generateClaimToken() {
  const bytes = randomBytes(8);
  let token = '';
  for (let index = 0; index < 8; index += 1) {
    token += CLAIM_CHARS[bytes[index] % CLAIM_CHARS.length];
  }
  return token;
}

export async function verifyAgentApiKey(rawKey: string) {
  if (!rawKey) return null;
  const hash = hashApiKey(rawKey);
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent authentication');
  }

  const sql = getSqlClient();
  const rows = await sql<{ agent_id: string }[]>`
    select agent_id
    from agent_api_keys
    where api_key_hash = ${hash}
      and status = 'active'
    order by created_at desc
    limit 1
  `;
  const record = rows[0] ?? null;
  return record ? { agentId: record.agent_id } : null;
}

export async function authenticateAgent(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return verifyAgentApiKey(authHeader.slice(7).trim());
}
