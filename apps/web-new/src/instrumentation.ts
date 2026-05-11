import { ensureApplicationDatabaseSchema } from '@/db/app-schema';
import { isDatabaseConfigured } from '@/db/postgres';

export async function register() {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await ensureApplicationDatabaseSchema();
  } catch (error) {
    console.warn(
      '[instrumentation] database schema initialization skipped',
      error
    );
  }
}
