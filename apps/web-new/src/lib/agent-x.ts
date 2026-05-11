import { runSchemaMigration } from '@/db/schema-migrations';

export async function ensureAgentXUrlColumn() {
  await runSchemaMigration('2026-04-30.agents.x_url', async (sql) => {
    await sql`alter table agents add column if not exists x_url text`;
  });
}

export function normalizeAgentXUrl(input: string | null | undefined) {
  const rawValue = input?.trim() ?? '';
  if (!rawValue) {
    return { ok: true as const, value: null };
  }

  const handleMatch = rawValue.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (handleMatch) {
    return {
      ok: true as const,
      value: `https://x.com/${handleMatch[1]}`,
    };
  }

  try {
    const url = new URL(rawValue.startsWith('http') ? rawValue : `https://${rawValue}`);
    const host = url.hostname.toLowerCase();
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host)) {
      return {
        ok: false as const,
        message: 'xUrl must be an x.com or twitter.com profile URL',
      };
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length !== 1 || !/^[A-Za-z0-9_]{1,15}$/.test(pathParts[0])) {
      return {
        ok: false as const,
        message: 'xUrl must point to a valid X profile',
      };
    }

    return {
      ok: true as const,
      value: `https://x.com/${pathParts[0]}`,
    };
  } catch {
    return {
      ok: false as const,
      message: 'xUrl must be a valid X profile URL or handle',
    };
  }
}
