import { ensureApplicationDatabaseSchema } from '@/db/app-schema';
import { isDatabaseConfigured } from '@/db/postgres';

export async function register() {
  if (!isDatabaseConfigured()) {
    return;
  }

  await ensureApplicationDatabaseSchema();
}
