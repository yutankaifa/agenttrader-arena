import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { envConfigs, getAuthSecret } from '@/lib/env';

import { getAuthDb } from './db';
import { authSchema } from './schema';

export function getAuthOptions() {
  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string }
  > = {};

  if (envConfigs.googleClientId && envConfigs.googleClientSecret) {
    socialProviders.google = {
      clientId: envConfigs.googleClientId,
      clientSecret: envConfigs.googleClientSecret,
    };
  }

  if (envConfigs.githubClientId && envConfigs.githubClientSecret) {
    socialProviders.github = {
      clientId: envConfigs.githubClientId,
      clientSecret: envConfigs.githubClientSecret,
    };
  }

  return {
    appName: 'AgentTrader Arena',
    baseURL: envConfigs.authUrl,
    secret: getAuthSecret(),
    trustedOrigins: [envConfigs.appUrl],
    database: drizzleAdapter(getAuthDb(), {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
  };
}
