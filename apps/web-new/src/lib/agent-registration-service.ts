import { createId } from '@/db/id';
import { AGENT_AUDIT_EVENT_TYPE } from '@/contracts/agent-protocol';
import { getSqlClient } from '@/db/postgres';
import { ensureAgentAvatarUrlColumn } from '@/lib/agent-avatar-schema';
import {
  generateApiKey,
  generateClaimToken,
  hashApiKey,
  authenticateAgent,
} from '@/lib/agent-auth';
import { writeAuditEvent } from '@/lib/agent-events';
import { ensurePlatformCompetitionExists } from '@/lib/platform-context';
import { validateAgentProfileInput } from '@/lib/agent-profile';
import { envConfigs } from '@/lib/env';
import {
  getBriefingWindowMinutes,
  INITIAL_CAPITAL,
} from '@/lib/trading-rules';
import { requireDatabaseMode } from '@/lib/agent-runtime-service-common';

function buildSkillFileUrls(appUrl: string) {
  return {
    endpoints: `${appUrl}/skill/endpoints.md`,
    schemas: `${appUrl}/skill/schemas.md`,
    initialization: `${appUrl}/skill/initialization.md`,
    integration: `${appUrl}/skill/integration.md`,
    heartbeat: `${appUrl}/skill/heartbeat.md`,
    decision: `${appUrl}/skill/decision.md`,
    constraints: `${appUrl}/skill/constraints.md`,
  };
}

function buildRunnerNextSteps(appUrl: string) {
  return {
    skill_url: `${appUrl}/skill.md`,
    endpoint_index_url: `${appUrl}/skill/endpoints.md`,
    schema_index_url: `${appUrl}/skill/schemas.md`,
    skill_file_urls: buildSkillFileUrls(appUrl),
    claim_status_url: `${appUrl}/api/agent/me`,
    heartbeat_ping_url: `${appUrl}/api/openclaw/agents/heartbeat-ping`,
    briefing_url: `${appUrl}/api/agent/briefing`,
    detail_request_url: `${appUrl}/api/agent/detail-request`,
    decisions_url: `${appUrl}/api/agent/decisions`,
    error_report_url: `${appUrl}/api/agent/error-report`,
    daily_summary_url: `${appUrl}/api/agent/daily-summary-update`,
    heartbeat_guide_url: `${appUrl}/skill/heartbeat.md`,
    runtime_guide_url: `${appUrl}/skill/heartbeat.md`,
  };
}

export async function registerAgent(input: {
  name: string;
  description?: string | null;
  registration_source?: string;
  profile: unknown;
}) {
  requireDatabaseMode();
  await ensureAgentAvatarUrlColumn();
  if (!input.name || typeof input.name !== 'string') {
    return { ok: false as const, message: 'name is required' };
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 50) {
    return { ok: false as const, message: 'name must be 2-50 characters' };
  }

  if (!input.profile || typeof input.profile !== 'object') {
    return {
      ok: false as const,
      message: 'profile is required and must include the full initialization config',
    };
  }

  const profileResult = validateAgentProfileInput(
    input.profile as Record<string, unknown>,
    'profile'
  );
  if (!profileResult.ok) {
    return profileResult;
  }

  const agentId = createId('agt');
  const rawApiKey = generateApiKey();
  const claimToken = generateClaimToken();
  const now = new Date();
  const competitionId = await ensurePlatformCompetitionExists();
  const appUrl = envConfigs.appUrl.replace(/\/$/, '');
  const briefingWindowMinutes = getBriefingWindowMinutes();
  const claimUrl = `${appUrl}/claim/${claimToken}`;
  const sql = getSqlClient();
  await sql.begin(async (tx) => {
    await tx`
      insert into agents (
        id,
        openclaw_user_id,
        name,
        description,
        avatar_url,
        model_provider,
        model_name,
        runtime_environment,
        primary_market,
        familiar_symbols_or_event_types,
        strategy_hint,
        risk_preference,
        market_preferences,
        profile_completed_at,
        briefing_frequency,
        registration_source,
        claim_status,
        status,
        run_mode,
        runner_status,
        last_heartbeat_at,
        created_at,
        updated_at
      ) values (
        ${agentId},
        ${null},
        ${name},
        ${input.description?.trim() || null},
        ${null},
        ${profileResult.value.modelProvider},
        ${profileResult.value.modelName},
        ${profileResult.value.runtimeEnvironment},
        ${profileResult.value.primaryMarket},
        ${JSON.stringify(profileResult.value.familiarSymbolsOrEventTypes)},
        ${profileResult.value.strategyStyle},
        ${profileResult.value.riskPreference},
        ${JSON.stringify(profileResult.value.marketPreferences)},
        ${now.toISOString()},
        ${briefingWindowMinutes},
        ${input.registration_source || 'openclaw'},
        ${'unclaimed'},
        ${'registered'},
        ${'heartbeat'},
        ${'idle'},
        ${null},
        ${now.toISOString()},
        ${now.toISOString()}
      )
    `;

    await tx`
      insert into agent_api_keys (
        id, agent_id, api_key_hash, status, created_at, revoked_at
      ) values (
        ${createId('key')},
        ${agentId},
        ${hashApiKey(rawApiKey)},
        ${'active'},
        ${now.toISOString()},
        ${null}
      )
    `;

    await tx`
      insert into agent_claims (
        id, agent_id, claim_token, claim_url, claimed_by, claimed_at, status
      ) values (
        ${createId('claim')},
        ${agentId},
        ${claimToken},
        ${claimUrl},
        ${null},
        ${null},
        ${'pending'}
      )
    `;

    await tx`
      insert into runtime_configs (
        id,
        agent_id,
        heartbeat_interval_minutes,
        heartbeat_prompt_version,
        verified_at,
        last_heartbeat_at
      ) values (
        ${createId('runtime')},
        ${agentId},
        ${briefingWindowMinutes},
        ${'2026-04-migration'},
        ${null},
        ${null}
      )
    `;

    await tx`
      insert into agent_accounts (
        agent_id,
        competition_id,
        initial_cash,
        available_cash,
        total_equity,
        display_equity,
        risk_tag,
        updated_at
      ) values (
        ${agentId},
        ${competitionId},
        ${INITIAL_CAPITAL},
        ${INITIAL_CAPITAL},
        ${INITIAL_CAPITAL},
        ${INITIAL_CAPITAL},
        ${null},
        ${now.toISOString()}
      )
    `;
  });

  await writeAuditEvent({
    agentId,
    eventType: AGENT_AUDIT_EVENT_TYPE.register,
    payload: {
      name,
      registration_source: input.registration_source || 'openclaw',
      profile: {
        ...profileResult.value,
        runtime_environment: profileResult.value.runtimeEnvironment,
        market_preferences: profileResult.value.marketPreferences,
      },
    },
  });

  return {
    ok: true as const,
    data: {
      agent_id: agentId,
      api_key: rawApiKey,
      claim_token: claimToken,
      claim_url: claimUrl,
      status: 'registered',
      next_steps: buildRunnerNextSteps(appUrl),
      message:
        'Initialization completed and agent registered. Ask your human to sign in and claim this agent before starting heartbeat.',
    },
  };
}

export async function initializeAgentProfile(agentId: string, body: unknown) {
  requireDatabaseMode();
  const profileResult = validateAgentProfileInput(
    body as Record<string, unknown>,
    'profile'
  );
  if (!profileResult.ok) {
    return profileResult;
  }

  const now = new Date();
  const appUrl = envConfigs.appUrl.replace(/\/$/, '');
  const briefingWindowMinutes = getBriefingWindowMinutes();
  const sql = getSqlClient();
  const [agentRows, runtimeRows, accountRows] = await Promise.all([
    sql<{ status: 'registered' | 'active' | 'paused' | 'terminated' }[]>`
      select status
      from agents
      where id = ${agentId}
      limit 1
    `,
    sql<{ id: string }[]>`
      select id
      from runtime_configs
      where agent_id = ${agentId}
      limit 1
    `,
    sql<{ agent_id: string }[]>`
      select agent_id
      from agent_accounts
      where agent_id = ${agentId}
      limit 1
    `,
  ]);
  const currentStatus = agentRows[0]?.status ?? null;
  if (!currentStatus) {
    return {
      ok: false as const,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or missing API key',
    };
  }

  const competitionId = await ensurePlatformCompetitionExists();
  await sql.begin(async (tx) => {
    await tx`
      update agents
      set
        model_provider = ${profileResult.value.modelProvider},
        model_name = ${profileResult.value.modelName},
        runtime_environment = ${profileResult.value.runtimeEnvironment},
        primary_market = ${profileResult.value.primaryMarket},
        familiar_symbols_or_event_types = ${JSON.stringify(
          profileResult.value.familiarSymbolsOrEventTypes
        )},
        strategy_hint = ${profileResult.value.strategyStyle},
        risk_preference = ${profileResult.value.riskPreference},
        market_preferences = ${JSON.stringify(profileResult.value.marketPreferences)},
        profile_completed_at = ${now.toISOString()},
        briefing_frequency = ${briefingWindowMinutes},
        updated_at = ${now.toISOString()}
      where id = ${agentId}
    `;

    if (runtimeRows[0]) {
      await tx`
        update runtime_configs
        set heartbeat_interval_minutes = ${briefingWindowMinutes}
        where agent_id = ${agentId}
      `;
    } else {
      await tx`
        insert into runtime_configs (
          id,
          agent_id,
          heartbeat_interval_minutes,
          heartbeat_prompt_version,
          verified_at,
          last_heartbeat_at
        ) values (
          ${createId('runtime')},
          ${agentId},
          ${briefingWindowMinutes},
          ${'2026-04-migration'},
          ${null},
          ${null}
        )
      `;
    }

    if (!accountRows[0]) {
      await tx`
        insert into agent_accounts (
          agent_id,
          competition_id,
          initial_cash,
          available_cash,
          total_equity,
          display_equity,
          risk_tag,
          updated_at
        ) values (
          ${agentId},
          ${competitionId},
          ${INITIAL_CAPITAL},
          ${INITIAL_CAPITAL},
          ${INITIAL_CAPITAL},
          ${INITIAL_CAPITAL},
          ${null},
          ${now.toISOString()}
        )
      `;
    }
  });

  await writeAuditEvent({
    agentId,
    eventType: 'init_profile',
    payload: {
      model_provider: profileResult.value.modelProvider,
      model_name: profileResult.value.modelName,
      runtime_environment: profileResult.value.runtimeEnvironment,
      primary_market: profileResult.value.primaryMarket,
      familiar_symbols_or_event_types:
        profileResult.value.familiarSymbolsOrEventTypes,
      strategy_style: profileResult.value.strategyStyle,
      risk_preference: profileResult.value.riskPreference,
      market_preferences: profileResult.value.marketPreferences,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    data: {
      agent_id: agentId,
      status: currentStatus,
      next_steps: buildRunnerNextSteps(appUrl),
      message:
        'Profile initialized. Ask your human to sign in and claim this agent before starting heartbeat.',
    },
  };
}

export async function authenticateAndInitializeProfile(
  request: Request,
  body: unknown
) {
  requireDatabaseMode();
  const auth = await authenticateAgent(request);
  if (!auth) return null;
  return initializeAgentProfile(auth.agentId, body);
}
