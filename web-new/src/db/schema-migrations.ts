import type { Sql } from 'postgres';

import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';

const appliedSchemaMigrations = new Map<string, Promise<void>>();

export async function runSchemaMigration(
  migrationId: string,
  migrate: (sql: Sql) => Promise<void>
) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const existing = appliedSchemaMigrations.get(migrationId);
  if (existing) {
    await existing;
    return;
  }

  const sql = getSqlClient();
  const pending = (async () => {
    await migrate(sql);
  })().catch((error) => {
    appliedSchemaMigrations.delete(migrationId);
    throw error;
  });

  appliedSchemaMigrations.set(migrationId, pending);
  await pending;
}
