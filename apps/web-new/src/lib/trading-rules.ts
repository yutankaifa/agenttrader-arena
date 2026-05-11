export const INITIAL_CAPITAL = 100000;
export type CompetitionPhase = 'testing' | 'official';
export const TRADING_FEE_RATE = 0.0005;
export const BUY_LIMIT_RATIO = 0.25;
export const MAX_POSITION_CONCENTRATION = 0.6;
export const MIN_CASH_FOR_NEW_BUYS = 100;

const DEFAULT_TESTING_BRIEFING_WINDOW_MINUTES = 5;
const DEFAULT_OFFICIAL_BRIEFING_WINDOW_MINUTES = 15;
const MIN_BRIEFING_WINDOW_MINUTES = 1;
const MAX_BRIEFING_WINDOW_MINUTES = 60;

export const COMPETITION_PHASE: CompetitionPhase =
  process.env.AGENTTRADER_COMPETITION_PHASE === 'official'
    ? 'official'
    : 'testing';

export const LEADERBOARD_MIN_EXECUTED_ACTIONS =
  COMPETITION_PHASE === 'official' ? 3 : 0;
export const LEADERBOARD_MIN_RUNTIME_HOURS = 0;

function parseConfiguredBoolean(value: string | undefined) {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  return null;
}

function parseConfiguredBriefingWindowMinutes(value: string | undefined) {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_BRIEFING_WINDOW_MINUTES ||
    parsed > MAX_BRIEFING_WINDOW_MINUTES
  ) {
    return null;
  }

  return parsed;
}

export function getLeaderboardVisibilityRule() {
  return {
    competition_phase: COMPETITION_PHASE,
    public_visibility_requires_claim: true,
    min_valid_executed_actions: LEADERBOARD_MIN_EXECUTED_ACTIONS,
  };
}

export function getBriefingWindowMinutes() {
  const configured = parseConfiguredBriefingWindowMinutes(
    process.env.AGENTTRADER_BRIEFING_WINDOW_MINUTES
  );
  if (configured != null) {
    return configured;
  }

  return COMPETITION_PHASE === 'official'
    ? DEFAULT_OFFICIAL_BRIEFING_WINDOW_MINUTES
    : DEFAULT_TESTING_BRIEFING_WINDOW_MINUTES;
}

export const BRIEFING_WINDOW_MINUTES = getBriefingWindowMinutes();

export function getBriefingWindowSeconds() {
  return getBriefingWindowMinutes() * 60;
}

export function isQuoteDebugEnabled() {
  const configured = parseConfiguredBoolean(
    process.env.AGENTTRADER_ENABLE_QUOTE_DEBUG
  );
  if (configured != null) {
    return configured;
  }

  return COMPETITION_PHASE === 'testing';
}

export function getBriefingWindowId(reference: string | Date | null | undefined) {
  if (!reference) return null;

  const date = typeof reference === 'string' ? new Date(reference) : reference;
  const slot = Math.floor(date.getUTCMinutes() / BRIEFING_WINDOW_MINUTES);
  const normalized = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      slot * BRIEFING_WINDOW_MINUTES,
      0,
      0
    )
  );

  return normalized.toISOString().slice(0, 16);
}

export function getBriefingWindowBounds(reference: string | Date) {
  const base = typeof reference === 'string' ? new Date(reference) : reference;
  const slot = Math.floor(base.getUTCMinutes() / BRIEFING_WINDOW_MINUTES);
  const openedAt = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      base.getUTCHours(),
      slot * BRIEFING_WINDOW_MINUTES,
      0,
      0
    )
  );
  const closesAt = new Date(openedAt.getTime() + BRIEFING_WINDOW_MINUTES * 60 * 1000);
  return {
    openedAt,
    closesAt,
    id: openedAt.toISOString().slice(0, 16),
  };
}
