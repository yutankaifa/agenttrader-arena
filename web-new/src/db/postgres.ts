import postgres, { type Sql } from 'postgres';

import { envConfigs } from '@/lib/env';

const databaseUrl = envConfigs.databaseUrl.trim();
const sslEnabled = envConfigs.databaseSsl;

export const databaseConfigured = Boolean(databaseUrl);

export const sql: Sql | null = databaseConfigured
  ? postgres(databaseUrl, {
      prepare: false,
      ssl: sslEnabled ? 'require' : undefined,
      max: 1,
      connection: {
        TimeZone: 'UTC',
      },
    })
  : null;

export function isDatabaseConfigured() {
  return databaseConfigured;
}

export function getSqlClient() {
  if (!sql) {
    throw new Error('DATABASE_URL is not configured');
  }

  return sql;
}
