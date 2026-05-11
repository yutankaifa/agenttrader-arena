import { readStore } from '@/db/store';
import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import {
  COMPETITION_PHASE,
  getLeaderboardVisibilityRule,
} from '@/lib/trading-rules';

export const PLATFORM_COMPETITION = {
  id: 'comp_open_2026',
  name: 'AgentTrader Open Season',
  status: 'active' as const,
  competition_phase: COMPETITION_PHASE,
  leaderboard_visibility: getLeaderboardVisibilityRule(),
};

export async function ensurePlatformCompetitionExists() {
  if (!isDatabaseConfigured()) {
    return PLATFORM_COMPETITION.id;
  }

  const sql = getSqlClient();
  const existing = await sql<{ id: string }[]>`
    select id
    from competitions
    where id = ${PLATFORM_COMPETITION.id}
    limit 1
  `;
  if (existing[0]) {
    return PLATFORM_COMPETITION.id;
  }

  try {
    await sql`
      insert into competitions (
        id, name, status, rule_version, created_at
      ) values (
        ${PLATFORM_COMPETITION.id},
        ${PLATFORM_COMPETITION.name},
        ${PLATFORM_COMPETITION.status},
        ${'0.1'},
        ${new Date().toISOString()}
      )
    `;
  } catch {
    // Ignore duplicate insert races.
  }

  return PLATFORM_COMPETITION.id;
}

export async function getPlatformCompetition() {
  if (!isDatabaseConfigured()) {
    const store = readStore();
    const row =
      store.competitions.find((item) => item.id === PLATFORM_COMPETITION.id) ??
      store.competitions[0] ??
      null;
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      marketTypes: row.marketTypes,
      ruleVersion: row.ruleVersion,
      startAt: row.startAt,
      endAt: row.endAt,
      createdAt: row.createdAt,
      competition_phase: COMPETITION_PHASE,
      leaderboard_visibility: getLeaderboardVisibilityRule(),
    };
  }

  const sql = getSqlClient();
  await ensurePlatformCompetitionExists();
  const rows = await sql<
    {
      id: string;
      name: string;
      description: string | null;
      status: 'upcoming' | 'active' | 'ended';
      market_types: string | null;
      rule_version: string | null;
      start_at: string | Date | null;
      end_at: string | Date | null;
      created_at: string | Date | null;
    }[]
  >`
    select
      id,
      name,
      description,
      status,
      market_types,
      rule_version,
      start_at,
      end_at,
      created_at
    from competitions
    where id = ${PLATFORM_COMPETITION.id}
    limit 1
  `;
  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    marketTypes: parseStringArray(row.market_types),
    ruleVersion: row.rule_version ?? '0.1',
    startAt: typeof row.start_at === 'string' ? row.start_at : row.start_at?.toISOString() ?? null,
    endAt: typeof row.end_at === 'string' ? row.end_at : row.end_at?.toISOString() ?? null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : row.created_at?.toISOString() ?? new Date().toISOString(),
    competition_phase: COMPETITION_PHASE,
    leaderboard_visibility: getLeaderboardVisibilityRule(),
  };
}

function parseStringArray(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
