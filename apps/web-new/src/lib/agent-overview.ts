import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { buildAccountPerformanceMetrics } from '@/lib/account-metrics';
import { ensureAgentXUrlColumn } from '@/lib/agent-x';
import {
  getAgentCompetitionStatus,
  getAgentLeaderboardRank,
} from '@/lib/agent-competition';
import { refreshDisplayEquity } from '@/lib/display-equity';
import { isAgentProfileComplete } from '@/lib/agent-profile';
import {
  getBriefingWindowId,
  getBriefingWindowMinutes,
  INITIAL_CAPITAL,
} from '@/lib/trading-rules';
import { toIsoString } from '@/lib/utils';

export async function buildAgentMeView(agentId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent overview');
  }

  await ensureAgentXUrlColumn();
  const sql = getSqlClient();
  const [agentRows, accountRows, runtimeRows, latestRank] =
    await Promise.all([
        sql<
          {
            id: string;
            name: string;
            description: string | null;
            x_url: string | null;
            claim_status: string | null;
            status: string;
            runner_status: string | null;
            model_provider: string | null;
            model_name: string | null;
            runtime_environment: string | null;
            primary_market: string | null;
            familiar_symbols_or_event_types: string | null;
            strategy_hint: string | null;
            risk_preference: string | null;
            market_preferences: string | null;
            last_heartbeat_at: string | Date | null;
          }[]
        >`
          select
            id,
            name,
            description,
            x_url,
            claim_status,
            status,
            runner_status,
            model_provider,
            model_name,
            runtime_environment,
            primary_market,
            familiar_symbols_or_event_types,
            strategy_hint,
            risk_preference,
            market_preferences,
            last_heartbeat_at
          from agents
          where id = ${agentId}
          limit 1
        `,
        sql<
          {
            initial_cash: number | null;
            available_cash: number | null;
            total_equity: number | null;
            display_equity: number | null;
            risk_tag: null | 'high_risk' | 'close_only' | 'terminated';
          }[]
        >`
          select
            initial_cash,
            available_cash,
            total_equity,
            display_equity,
            risk_tag
          from agent_accounts
          where agent_id = ${agentId}
          limit 1
        `,
        sql<
          {
            heartbeat_interval_minutes: number | null;
            verified_at: string | Date | null;
            last_heartbeat_at: string | Date | null;
            last_heartbeat_success_at: string | Date | null;
            last_heartbeat_failure_at: string | Date | null;
            last_heartbeat_failure_code: string | null;
            last_heartbeat_failure_message: string | null;
            last_heartbeat_failure_status: number | null;
            consecutive_heartbeat_failures: number | null;
          }[]
        >`
          select
            heartbeat_interval_minutes,
            verified_at,
            last_heartbeat_at,
            last_heartbeat_success_at,
            last_heartbeat_failure_at,
            last_heartbeat_failure_code,
            last_heartbeat_failure_message,
            last_heartbeat_failure_status,
            consecutive_heartbeat_failures
          from runtime_configs
          where agent_id = ${agentId}
          limit 1
        `,
        getAgentLeaderboardRank(agentId),
    ]);

  const agent = agentRows[0] ?? null;
  if (!agent) {
    return null;
  }

  const marked = await refreshDisplayEquity(agentId);
  const competition = await getAgentCompetitionStatus(agentId, agent.claim_status);
  const account = accountRows[0] ?? null;
  const runtime = runtimeRows[0] ?? null;
  const familiarSymbols = parseDbStringArray(agent.familiar_symbols_or_event_types);
  const marketPreferences = parseDbStringArray(agent.market_preferences);
  const initialCash = marked.initialCash ?? account?.initial_cash ?? INITIAL_CAPITAL;
  const availableCash = marked.availableCash ?? account?.available_cash ?? initialCash;
  const totalEquity = marked.totalEquity ?? account?.total_equity ?? initialCash;
  const displayEquity = marked.displayEquity ?? account?.display_equity ?? totalEquity;
  const metrics = buildAccountPerformanceMetrics({
    initialCash,
    availableCash,
    totalEquity,
    displayEquity,
    riskTag: marked.riskTag ?? account?.risk_tag ?? null,
  });
  const accountView = {
    available_cash: metrics.availableCash,
    total_equity: metrics.totalEquity,
    display_equity: metrics.displayEquity,
    return_rate: metrics.returnRate,
    display_return_rate: metrics.displayReturnRate,
    risk_tag: metrics.riskTag,
    risk_mode: metrics.riskMode,
    close_only: metrics.closeOnly,
    initial_cash: metrics.initialCash,
    open_positions: marked.markedPositions.length,
  };
  const lastHeartbeatAt = toIsoString(agent.last_heartbeat_at);

  return {
    agent_id: agent.id,
    name: agent.name,
    status: agent.status,
    claim_status: agent.claim_status,
    runner_status: agent.runner_status,
    profile_initialized: isAgentProfileComplete({
      modelProvider: agent.model_provider,
      modelName: agent.model_name,
      runtimeEnvironment: agent.runtime_environment,
      primaryMarket: agent.primary_market,
      familiarSymbolsOrEventTypes: familiarSymbols,
      strategyHint: agent.strategy_hint,
      riskPreference: agent.risk_preference,
    }),
    model_provider: agent.model_provider,
    model_name: agent.model_name,
    runtime_environment: agent.runtime_environment,
    primary_market: agent.primary_market,
    familiar_symbols_or_event_types: familiarSymbols,
    strategy_style: agent.strategy_hint,
    strategy_hint: agent.strategy_hint,
    risk_preference: agent.risk_preference,
    market_preferences: marketPreferences,
    briefing_frequency:
      runtime?.heartbeat_interval_minutes ?? getBriefingWindowMinutes(),
    last_heartbeat_at: lastHeartbeatAt,
    competition_phase: competition.competition_phase,
    leaderboard_visibility_status: competition.leaderboard_visibility_status,
    required_executed_actions_for_visibility:
      competition.required_executed_actions_for_visibility,
    executed_action_count: competition.executed_action_count,
    competition,
    account: accountView,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      x_url: agent.x_url,
      claim_status: agent.claim_status,
      status: agent.status,
      runner_status: agent.runner_status,
      runtime_environment: agent.runtime_environment,
      model_provider: agent.model_provider,
      model_name: agent.model_name,
      primary_market: agent.primary_market,
      market_preferences: marketPreferences,
      familiar_symbols_or_event_types: familiarSymbols,
      strategy_style: agent.strategy_hint,
      risk_preference: agent.risk_preference,
      last_heartbeat_at: lastHeartbeatAt,
    },
    runtime: {
      heartbeat_interval_minutes:
        runtime?.heartbeat_interval_minutes ?? getBriefingWindowMinutes(),
      verified_at: toIsoString(runtime?.verified_at),
      last_heartbeat_at: toIsoString(runtime?.last_heartbeat_at),
      last_heartbeat_success_at: toIsoString(runtime?.last_heartbeat_success_at),
      last_heartbeat_failure_at: toIsoString(runtime?.last_heartbeat_failure_at),
      last_heartbeat_failure_code: runtime?.last_heartbeat_failure_code ?? null,
      last_heartbeat_failure_message:
        runtime?.last_heartbeat_failure_message ?? null,
      last_heartbeat_failure_status:
        runtime?.last_heartbeat_failure_status ?? null,
      consecutive_heartbeat_failures:
        runtime?.consecutive_heartbeat_failures ?? 0,
      active_window_id: getBriefingWindowId(lastHeartbeatAt),
    },
    leaderboard: latestRank
      ? {
          rank: latestRank.rank,
          return_rate: latestRank.returnRate,
          drawdown: latestRank.drawdown,
          top_tier: latestRank.topTier,
          snapshot_at: latestRank.snapshotAt,
        }
      : null,
  };
}

function parseDbStringArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Ignore and fall back to comma-separated parsing.
  }

  return value
    .split(/[|,/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
