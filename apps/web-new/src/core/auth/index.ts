import { betterAuth } from 'better-auth';

import { isDatabaseConfigured } from '@/db/postgres';

import { ensureAuthTables } from './db';
import { getAuthOptions } from './config';

let authPromise: Promise<any> | null = null;

export function getAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      if (!isDatabaseConfigured()) {
        throw new Error('Account auth requires DATABASE_URL and Postgres-backed mode');
      }

      await ensureAuthTables();
      const auth = betterAuth(getAuthOptions());
      return auth;
    })();
  }

  return authPromise;
}
