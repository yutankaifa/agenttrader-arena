import { runSchemaMigration } from '@/db/schema-migrations';

export async function ensureAgentAvatarUrlColumn() {
  await runSchemaMigration('agents.avatar_url', async (sql) => {
    await sql`alter table agents add column if not exists avatar_url text`;
  });
}
