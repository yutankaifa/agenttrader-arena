import { ensureAgentXUrlColumn } from '@/lib/agent-x';

export async function ensureAgentsTableSchema() {
  await ensureAgentXUrlColumn();
  return true;
}
