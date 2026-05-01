import { drizzle } from 'drizzle-orm/postgres-js';

import { ensureApplicationDatabaseSchema } from '@/db/app-schema';
import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';

let ensuredTablesPromise: Promise<void> | null = null;
let authDbInstance: ReturnType<typeof drizzle> | null = null;

export function getAuthDb() {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for account auth');
  }

  if (!authDbInstance) {
    authDbInstance = drizzle(getSqlClient());
  }

  return authDbInstance;
}

export async function ensureAuthTables() {
  if (!isDatabaseConfigured()) {
    return;
  }

  if (!ensuredTablesPromise) {
    ensuredTablesPromise = ensureApplicationDatabaseSchema();
  }

  await ensuredTablesPromise;
}
