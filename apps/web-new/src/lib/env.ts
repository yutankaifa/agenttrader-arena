function buildDatabaseUrl() {
  const dbHost = process.env.DB_HOST?.trim() ?? '';
  const dbPort = process.env.DB_PORT?.trim() ?? '';
  const dbName = process.env.DB_NAME?.trim() ?? '';
  const dbUser = process.env.DB_USER?.trim() ?? '';
  const dbPassword = process.env.DB_PASSWORD ?? '';
  const sslMode = process.env.DB_SSLMODE?.trim() ?? '';
  const explicitDatabaseUrl = process.env.DATABASE_URL?.trim() ?? '';

  if (dbHost && dbName && dbUser) {
    const encodedUser = encodeURIComponent(dbUser);
    const encodedPassword = encodeURIComponent(dbPassword);
    const encodedName = encodeURIComponent(dbName);
    const authSegment = dbPassword
      ? `${encodedUser}:${encodedPassword}`
      : encodedUser;

    if (dbHost.startsWith('/')) {
      const params = new URLSearchParams({ host: dbHost });
      if (sslMode) {
        params.set('sslmode', sslMode);
      }

      return `postgres://${authSegment}@localhost/${encodedName}?${params.toString()}`;
    }

    const portSegment = dbPort ? `:${encodeURIComponent(dbPort)}` : '';
    const params = new URLSearchParams();
    if (sslMode) {
      params.set('sslmode', sslMode);
    }

    const querySegment = params.toString() ? `?${params.toString()}` : '';
    return `postgres://${authSegment}@${dbHost}${portSegment}/${encodedName}${querySegment}`;
  }

  return explicitDatabaseUrl;
}

const LOCAL_AUTH_SECRET =
  'better-auth-secret-that-is-long-enough-for-local-development';
const LOCAL_CRON_SECRET = 'local-cron-secret';

function readRuntimeSecret(
  envName: 'AUTH_SECRET' | 'CRON_SECRET',
  fallback: string
) {
  const value = process.env[envName]?.trim();
  if (value) {
    return value;
  }

  if (process.env.NODE_ENV !== 'production') {
    return fallback;
  }

  throw new Error(`${envName} is required when NODE_ENV=production`);
}

function normalizeAppUrl(value: string | undefined) {
  const normalized = value?.trim().replace(/\/$/, '');
  return normalized || 'http://localhost:3000';
}

function normalizeAuthUrl(value: string | undefined, appUrl: string) {
  const normalized = value?.trim().replace(/\/$/, '');
  if (!normalized) {
    return `${appUrl}/api/auth`;
  }

  return normalized.endsWith('/api/auth') ? normalized : `${normalized}/api/auth`;
}

function isDatabaseSslEnabled(databaseUrl: string) {
  const explicitFlag = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (explicitFlag === 'true') {
    return true;
  }
  if (explicitFlag === 'false') {
    return false;
  }

  const sslMode = process.env.DB_SSLMODE?.trim().toLowerCase() ?? '';
  if (
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full'
  ) {
    return true;
  }

  return /(?:\?|&)sslmode=(require|verify-ca|verify-full)(?:&|$)/i.test(
    databaseUrl
  );
}

const databaseUrl = buildDatabaseUrl();
const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

export const envConfigs = {
  appUrl,
  authUrl: normalizeAuthUrl(process.env.AUTH_URL, appUrl),
  databaseUrl,
  databaseSsl: isDatabaseSslEnabled(databaseUrl),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
};

export function getAuthSecret() {
  return readRuntimeSecret('AUTH_SECRET', LOCAL_AUTH_SECRET);
}

export function getCronSecret() {
  return readRuntimeSecret('CRON_SECRET', LOCAL_CRON_SECRET);
}
