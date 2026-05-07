import { isDatabaseConfigured } from '@/db/postgres';
import { runSchemaMigration } from '@/db/schema-migrations';

let ensuredApplicationSchemaPromise: Promise<void> | null = null;

export async function ensureApplicationDatabaseSchema() {
  if (!isDatabaseConfigured()) {
    return;
  }

  if (!ensuredApplicationSchemaPromise) {
    ensuredApplicationSchemaPromise = runSchemaMigration(
      '2026-05-01.application-schema',
      async (sql) => {
        await sql`
          create table if not exists app_state (
            id text primary key,
            payload jsonb not null,
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists auth_users (
            id text primary key,
            name text not null,
            email text not null unique,
            email_verified boolean not null default false,
            image text,
            created_at timestamptz not null,
            updated_at timestamptz not null
          )
        `;
        await sql`
          create table if not exists auth_sessions (
            id text primary key,
            user_id text not null references auth_users(id) on delete cascade,
            token text not null unique,
            expires_at timestamptz not null,
            created_at timestamptz not null,
            updated_at timestamptz not null
          )
        `;

        await sql`
          create table if not exists "user" (
            id text primary key,
            name text not null,
            email text not null unique,
            email_verified boolean not null default false,
            image text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists session (
            id text primary key,
            expires_at timestamptz not null,
            token text not null unique,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            ip_address text,
            user_agent text,
            user_id text not null references "user"(id) on delete cascade
          )
        `;
        await sql`
          create table if not exists account (
            id text primary key,
            account_id text not null,
            provider_id text not null,
            user_id text not null references "user"(id) on delete cascade,
            access_token text,
            refresh_token text,
            id_token text,
            access_token_expires_at timestamptz,
            refresh_token_expires_at timestamptz,
            scope text,
            password text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists verification (
            id text primary key,
            identifier text not null,
            value text not null,
            expires_at timestamptz not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `;

        await sql`
          create table if not exists agents (
            id text primary key,
            openclaw_user_id text,
            name text not null,
            description text,
            avatar_url text,
            x_url text,
            model_provider text,
            model_name text,
            runtime_environment text,
            primary_market text,
            familiar_symbols_or_event_types text,
            strategy_hint text,
            risk_preference text,
            market_preferences text,
            profile_completed_at timestamptz,
            briefing_frequency integer,
            registration_source text,
            claim_status text,
            status text,
            run_mode text,
            runner_status text,
            last_heartbeat_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          alter table agents add column if not exists openclaw_user_id text
        `;
        await sql`
          alter table agents add column if not exists avatar_url text
        `;
        await sql`
          alter table agents add column if not exists x_url text
        `;
        await sql`
          alter table agents add column if not exists primary_market text
        `;
        await sql`
          alter table agents add column if not exists familiar_symbols_or_event_types text
        `;
        await sql`
          alter table agents add column if not exists risk_preference text
        `;
        await sql`
          alter table agents add column if not exists market_preferences text
        `;
        await sql`
          alter table agents add column if not exists profile_completed_at timestamptz
        `;
        await sql`
          alter table agents add column if not exists briefing_frequency integer
        `;
        await sql`
          alter table agents add column if not exists registration_source text
        `;
        await sql`
          alter table agents add column if not exists run_mode text
        `;
        await sql`
          alter table agents add column if not exists created_at timestamptz
        `;
        await sql`
          alter table agents add column if not exists updated_at timestamptz
        `;

        await sql`
          create table if not exists agent_api_keys (
            id text primary key,
            agent_id text not null,
            api_key_hash text not null,
            status text not null,
            created_at timestamptz not null default now(),
            revoked_at timestamptz
          )
        `;
        await sql`
          create table if not exists agent_claims (
            id text primary key,
            agent_id text not null,
            claim_token text not null unique,
            claim_url text,
            claimed_by text,
            claimed_at timestamptz,
            status text not null
          )
        `;
        await sql`
          create table if not exists runtime_configs (
            id text primary key,
            agent_id text not null unique,
            heartbeat_interval_minutes integer,
            heartbeat_prompt_version text,
            verified_at timestamptz,
            last_heartbeat_at timestamptz
          )
        `;
        await sql`
          alter table runtime_configs add column if not exists id text
        `;
        await sql`
          alter table runtime_configs add column if not exists heartbeat_prompt_version text
        `;
        await sql`
          update runtime_configs
          set id = coalesce(id, 'runtime_' || agent_id)
          where coalesce(id, '') = ''
        `;
        await sql`
          create table if not exists competitions (
            id text primary key,
            name text not null,
            description text,
            status text not null,
            market_types text,
            rule_version text,
            start_at timestamptz,
            end_at timestamptz,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists agent_accounts (
            agent_id text primary key,
            competition_id text,
            initial_cash numeric,
            available_cash numeric,
            total_equity numeric,
            display_equity numeric,
            risk_tag text,
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists positions (
            id text primary key,
            agent_id text not null,
            symbol text not null,
            market text not null,
            event_id text,
            outcome_id text,
            outcome_name text,
            position_size numeric,
            entry_price numeric,
            market_price numeric,
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists detail_requests (
            id text primary key,
            agent_id text not null,
            competition_id text not null,
            request_id text not null,
            decision_window_start timestamptz,
            briefing_window_id text,
            request_reason text not null,
            objects_requested text not null,
            symbols_requested text not null,
            response_summary text not null,
            requested_at timestamptz not null
          )
        `;
        await sql`
          create table if not exists decision_submissions (
            id text primary key,
            decision_id text not null,
            agent_id text not null,
            competition_id text not null,
            decision_rationale text not null,
            fallback_reasoning_summary text,
            reasoning_summary text,
            reason_tag text,
            briefing_window_id text,
            status text not null,
            rejection_reason text,
            received_at timestamptz not null
          )
        `;
        await sql`
          create table if not exists decision_window_consumptions (
            agent_id text not null,
            briefing_window_id text not null,
            submission_id text not null,
            decision_id text not null,
            status text not null,
            rejection_reason text,
            consumed_at timestamptz not null,
            primary key (agent_id, briefing_window_id)
          )
        `;
        await sql`
          alter table decision_submissions add column if not exists fallback_reasoning_summary text
        `;
        await sql`
          alter table decision_submissions add column if not exists reasoning_summary text
        `;
        await sql`
          update decision_submissions
          set
            fallback_reasoning_summary = coalesce(
              fallback_reasoning_summary,
              reasoning_summary
            ),
            reasoning_summary = coalesce(
              reasoning_summary,
              fallback_reasoning_summary
            )
          where fallback_reasoning_summary is null
             or reasoning_summary is null
        `;
        await sql`
          alter table decision_window_consumptions add column if not exists rejection_reason text
        `;
        await sql`
          insert into decision_window_consumptions (
            agent_id,
            briefing_window_id,
            submission_id,
            decision_id,
            status,
            rejection_reason,
            consumed_at
          )
          select
            canonical.agent_id,
            canonical.briefing_window_id,
            canonical.id,
            canonical.decision_id,
            canonical.status,
            canonical.rejection_reason,
            canonical.received_at
          from (
            select distinct on (agent_id, briefing_window_id)
              id,
              agent_id,
              briefing_window_id,
              decision_id,
              status,
              rejection_reason,
              received_at
            from decision_submissions
            where briefing_window_id is not null
            order by agent_id, briefing_window_id, received_at asc, id asc
          ) as canonical
          on conflict (agent_id, briefing_window_id) do nothing
        `;
        await sql`
          create table if not exists decision_actions (
            id text primary key,
            submission_id text not null,
            client_action_id text,
            symbol text not null,
            object_id text,
            side text not null,
            requested_units numeric,
            amount_usd numeric not null,
            market text not null,
            event_id text,
            outcome_id text,
            outcome_name text,
            reason_tag text,
            display_rationale text,
            order_type text,
            status text not null,
            rejection_reason text
          )
        `;
        await sql`
          create table if not exists trade_executions (
            id text primary key,
            action_id text not null,
            requested_units numeric,
            filled_units numeric,
            fill_price numeric,
            slippage numeric,
            fee numeric,
            quote_source text,
            execution_method text,
            depth_snapshot text,
            executed_at timestamptz not null
          )
        `;
        await sql`
          alter table trade_executions add column if not exists quote_source text
        `;
        await sql`
          create table if not exists live_trade_events (
            id text primary key,
            competition_id text,
            agent_id text not null,
            submission_id text not null,
            action_id text not null,
            rank_snapshot integer,
            symbol text not null,
            side text not null,
            notional_usd numeric,
            position_ratio numeric,
            outcome_name text,
            reason_tag text,
            display_rationale text,
            executed_at timestamptz not null
          )
        `;
        await sql`
          create table if not exists account_snapshots (
            id text primary key,
            agent_id text not null,
            ts timestamptz not null,
            cash numeric,
            equity numeric,
            drawdown numeric,
            return_rate numeric
          )
        `;
        await sql`
          create table if not exists leaderboard_snapshots (
            id text primary key,
            competition_id text,
            agent_id text,
            rank integer,
            return_rate numeric,
            equity_value numeric,
            change_24h numeric,
            drawdown numeric,
            model_name text,
            top_tier text,
            rank_change_24h integer,
            snapshot_at timestamptz
          )
        `;
        await sql`
          create table if not exists audit_logs (
            id text primary key,
            agent_id text,
            event_type text not null,
            payload text,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists agent_briefings (
            id text primary key,
            agent_id text not null,
            briefing_window_id text,
            payload text not null,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists agent_protocol_events (
            id text primary key,
            agent_id text not null,
            endpoint_key text not null,
            http_method text not null,
            request_id text,
            decision_id text,
            briefing_window_id text,
            status_code integer not null,
            request_success boolean not null,
            request_payload text,
            response_payload text,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists agent_error_reports (
            id text primary key,
            agent_id text not null,
            report_type text not null,
            source_endpoint text,
            http_method text,
            request_id text,
            decision_id text,
            window_id text,
            error_code text,
            status_code integer,
            summary text not null,
            request_payload text,
            response_payload text,
            runtime_context text,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists risk_events (
            id text primary key,
            agent_id text not null,
            competition_id text,
            event_type text not null,
            trigger_value numeric,
            threshold_value numeric,
            action_taken text,
            resolved_at timestamptz,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists agent_daily_summaries (
            id text primary key,
            agent_id text not null,
            summary_date text not null,
            summary text not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists system_actions (
            id text primary key,
            agent_id text,
            position_id text,
            action_source text not null,
            reason text,
            payload text,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          create table if not exists market_instruments (
            id text primary key,
            market text not null,
            symbol text not null,
            display_name text,
            provider text not null,
            provider_symbol text,
            provider_market_id text,
            asset_id text,
            is_active boolean,
            metadata text
          )
        `;
        await sql`
          alter table market_instruments add column if not exists provider_symbol text
        `;
        await sql`
          alter table market_instruments add column if not exists asset_id text
        `;
        await sql`
          create table if not exists market_data_snapshots (
            id text primary key,
            instrument_id text not null,
            provider text not null,
            quote_ts timestamptz not null,
            last_price numeric,
            bid numeric,
            ask numeric,
            midpoint numeric,
            spread numeric,
            bid_size numeric,
            ask_size numeric,
            depth_snapshot text,
            raw_payload text
          )
        `;
        await sql`
          create table if not exists market_candles (
            id text primary key,
            instrument_id text not null,
            market text,
            interval text not null,
            open_time timestamptz not null,
            close_time timestamptz,
            open numeric,
            high numeric,
            low numeric,
            close numeric,
            volume numeric,
            trade_count numeric,
            vwap numeric,
            outcome_id text,
            created_at timestamptz not null default now()
          )
        `;
        await sql`
          alter table market_candles add column if not exists market text
        `;
        await sql`
          alter table market_candles add column if not exists created_at timestamptz
        `;

        await sql`
          create index if not exists idx_auth_users_lower_email
          on auth_users (lower(email))
        `;
        await sql`
          create index if not exists idx_auth_sessions_user_id
          on auth_sessions (user_id)
        `;
        await sql`
          create index if not exists idx_better_auth_user_email
          on "user" (email)
        `;
        await sql`
          create index if not exists idx_better_auth_session_user_id
          on session (user_id)
        `;
        await sql`
          create index if not exists idx_better_auth_account_user_id
          on account (user_id)
        `;
        await sql`
          create index if not exists idx_better_auth_account_provider
          on account (provider_id, account_id)
        `;
        await sql`
          create index if not exists idx_better_auth_verification_identifier
          on verification (identifier)
        `;
        await sql`
          create index if not exists idx_agent_api_keys_agent_id
          on agent_api_keys (agent_id)
        `;
        await sql`
          create index if not exists idx_agent_api_keys_hash
          on agent_api_keys (api_key_hash)
        `;
        await sql`
          create index if not exists idx_agent_claims_agent_id
          on agent_claims (agent_id)
        `;
        await sql`
          create index if not exists idx_agent_claims_status
          on agent_claims (status, claimed_by)
        `;
        await sql`
          create index if not exists idx_runtime_configs_agent_id
          on runtime_configs (agent_id)
        `;
        await sql`
          create index if not exists idx_agent_accounts_competition
          on agent_accounts (competition_id)
        `;
        await sql`
          create index if not exists idx_positions_agent_id
          on positions (agent_id)
        `;
        await sql`
          create index if not exists idx_detail_requests_agent_window
          on detail_requests (agent_id, briefing_window_id, requested_at desc)
        `;
        await sql`
          create index if not exists idx_decision_submissions_agent_received
          on decision_submissions (agent_id, received_at desc)
        `;
        await sql`
          create index if not exists idx_decision_submissions_agent_decision
          on decision_submissions (agent_id, decision_id)
        `;
        await sql`
          create index if not exists idx_decision_window_consumptions_submission
          on decision_window_consumptions (submission_id)
        `;
        await sql`
          create index if not exists idx_decision_actions_submission
          on decision_actions (submission_id)
        `;
        await sql`
          create index if not exists idx_decision_actions_client_action_id
          on decision_actions (client_action_id)
        `;
        await sql`
          create index if not exists idx_trade_executions_action_id
          on trade_executions (action_id)
        `;
        await sql`
          create index if not exists idx_trade_executions_executed_at
          on trade_executions (executed_at desc)
        `;
        await sql`
          create index if not exists idx_decision_actions_submission_status
          on decision_actions (submission_id, status)
        `;
        await sql`
          create index if not exists idx_positions_agent_symbol_market_object
          on positions (agent_id, symbol, market, event_id, outcome_id, updated_at desc)
        `;
        await sql`
          create index if not exists idx_live_trade_events_agent_time
          on live_trade_events (agent_id, executed_at desc)
        `;
        await sql`
          create index if not exists idx_live_trade_events_executed_at
          on live_trade_events (executed_at desc)
        `;
        await sql`
          create index if not exists idx_account_snapshots_agent_ts
          on account_snapshots (agent_id, ts desc)
        `;
        await sql`
          create index if not exists idx_leaderboard_snapshots_agent_time
          on leaderboard_snapshots (agent_id, snapshot_at desc)
        `;
        await sql`
          create index if not exists idx_leaderboard_snapshots_snapshot_rank
          on leaderboard_snapshots (snapshot_at desc, rank asc)
        `;
        await sql`
          create index if not exists idx_audit_logs_agent_time
          on audit_logs (agent_id, created_at desc)
        `;
        await sql`
          create index if not exists idx_agent_briefings_agent_time
          on agent_briefings (agent_id, created_at desc)
        `;
        await sql`
          create index if not exists idx_agent_protocol_events_agent_time
          on agent_protocol_events (agent_id, created_at desc)
        `;
        await sql`
          create index if not exists idx_agent_protocol_events_endpoint_time
          on agent_protocol_events (endpoint_key, created_at desc)
        `;
        await sql`
          create index if not exists idx_agent_error_reports_agent_time
          on agent_error_reports (agent_id, created_at desc)
        `;
        await sql`
          create index if not exists idx_risk_events_agent_time
          on risk_events (agent_id, created_at desc)
        `;
        await sql`
          create index if not exists idx_agent_daily_summaries_agent_date
          on agent_daily_summaries (agent_id, summary_date desc, updated_at desc)
        `;
        await sql`
          create index if not exists idx_system_actions_agent_time
          on system_actions (agent_id, created_at desc)
        `;
        await sql`
          create index if not exists idx_market_instruments_market_upper_symbol
          on market_instruments (market, upper(symbol))
        `;
        await sql`
          create index if not exists idx_market_data_snapshots_instrument_time
          on market_data_snapshots (instrument_id, quote_ts desc)
        `;
        await sql`
          create index if not exists idx_market_candles_instrument_interval_time
          on market_candles (instrument_id, interval, open_time desc)
        `;
      }
    ).catch((error) => {
      ensuredApplicationSchemaPromise = null;
      throw error;
    });
  }

  await ensuredApplicationSchemaPromise;
}
