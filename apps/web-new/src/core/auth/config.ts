import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { envConfigs, getAuthSecret } from '@/lib/env';

import { getAuthDb } from './db';
import { authSchema } from './schema';

function toOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/api\/auth\/?$/, '').replace(/\/$/, '');
  }
}

export function getAuthOptions() {
  const socialProviders: Record<
    string,
    {
      clientId: string;
      clientSecret: string;
      prompt?: string;
    }
  > = {};
  const trustedOrigins = Array.from(
    new Set([toOrigin(envConfigs.appUrl), toOrigin(envConfigs.authUrl)].filter(Boolean))
  );

  if (envConfigs.googleClientId && envConfigs.googleClientSecret) {
    socialProviders.google = {
      clientId: envConfigs.googleClientId,
      clientSecret: envConfigs.googleClientSecret,
      prompt: 'select_account',
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
    baseURL: envConfigs.appUrl,
    basePath: '/api/auth',
    secret: getAuthSecret(),
    trustedOrigins,
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
