-- AgentTrader PostgreSQL schema
-- Derived from current application code in web-new/src and web-new/tests.
-- Intended for rebuilding a local database from scratch so runtime/auth APIs
-- do not fail on missing tables or columns.

begin;

create table if not exists app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists auth_users (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references auth_users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists "user" (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id text not null references "user"(id) on delete cascade
);

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
);

create table if not exists verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
);

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
);

create table if not exists agent_api_keys (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  api_key_hash text not null,
  status text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists agent_claims (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  claim_token text not null unique,
  claim_url text,
  claimed_by text,
  claimed_at timestamptz,
  status text not null
);

create table if not exists runtime_configs (
  id text primary key,
  agent_id text not null unique references agents(id) on delete cascade,
  heartbeat_interval_minutes integer,
  heartbeat_prompt_version text,
  verified_at timestamptz,
  last_heartbeat_at timestamptz
);

create table if not exists agent_accounts (
  agent_id text primary key references agents(id) on delete cascade,
  competition_id text references competitions(id) on delete set null,
  initial_cash numeric,
  available_cash numeric,
  total_equity numeric,
  display_equity numeric,
  risk_tag text,
  updated_at timestamptz
);

create table if not exists positions (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  symbol text not null,
  market text not null,
  event_id text,
  outcome_id text,
  outcome_name text,
  position_size numeric,
  entry_price numeric,
  market_price numeric,
  updated_at timestamptz
);

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
  metadata text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
);

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
  created_at timestamptz
);

create table if not exists detail_requests (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  competition_id text references competitions(id) on delete set null,
  request_id text not null,
  decision_window_start timestamptz not null,
  briefing_window_id text not null,
  request_reason text not null,
  objects_requested text not null,
  symbols_requested text not null,
  response_summary text not null,
  requested_at timestamptz not null
);

create table if not exists decision_submissions (
  id text primary key,
  decision_id text not null,
  agent_id text not null references agents(id) on delete cascade,
  competition_id text references competitions(id) on delete set null,
  decision_rationale text not null,
  fallback_reasoning_summary text,
  reasoning_summary text,
  reason_tag text,
  briefing_window_id text,
  status text not null,
  rejection_reason text,
  received_at timestamptz not null
);

create table if not exists decision_actions (
  id text primary key,
  submission_id text not null references decision_submissions(id) on delete cascade,
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
);

create table if not exists trade_executions (
  id text primary key,
  action_id text not null references decision_actions(id) on delete cascade,
  requested_units numeric,
  filled_units numeric,
  fill_price numeric,
  slippage numeric,
  fee numeric,
  quote_source text,
  execution_method text,
  depth_snapshot text,
  executed_at timestamptz not null
);

create table if not exists leaderboard_snapshots (
  id text primary key,
  competition_id text references competitions(id) on delete set null,
  agent_id text not null references agents(id) on delete cascade,
  rank integer,
  return_rate numeric,
  equity_value numeric,
  change_24h numeric,
  drawdown numeric,
  model_name text,
  top_tier text,
  rank_change_24h integer,
  snapshot_at timestamptz
);

create table if not exists live_trade_events (
  id text primary key,
  competition_id text references competitions(id) on delete set null,
  agent_id text not null references agents(id) on delete cascade,
  submission_id text not null references decision_submissions(id) on delete cascade,
  action_id text not null references decision_actions(id) on delete cascade,
  rank_snapshot integer,
  symbol text not null,
  side text not null,
  notional_usd numeric,
  position_ratio numeric,
  outcome_name text,
  reason_tag text,
  display_rationale text,
  executed_at timestamptz not null
);

create table if not exists risk_events (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  competition_id text references competitions(id) on delete set null,
  event_type text not null,
  trigger_value numeric,
  threshold_value numeric,
  action_taken text,
  resolved_at timestamptz,
  created_at timestamptz not null
);

create table if not exists account_snapshots (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  ts timestamptz not null,
  cash numeric,
  equity numeric,
  drawdown numeric,
  return_rate numeric
);

create table if not exists audit_logs (
  id text primary key,
  agent_id text references agents(id) on delete cascade,
  event_type text not null,
  payload text,
  created_at timestamptz not null
);

create table if not exists agent_briefings (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  briefing_window_id text,
  payload text not null,
  created_at timestamptz not null
);

create table if not exists agent_protocol_events (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  endpoint_key text not null,
  http_method text not null,
  request_id text,
  decision_id text,
  briefing_window_id text,
  status_code integer not null,
  request_success boolean not null,
  request_payload text,
  response_payload text,
  created_at timestamptz not null
);

create table if not exists agent_error_reports (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
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
  created_at timestamptz not null
);

create table if not exists agent_daily_summaries (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  summary_date text not null,
  summary text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists system_actions (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  action_type text,
  payload text,
  created_at timestamptz not null default now()
);

create index if not exists idx_better_auth_session_user_id
  on session (user_id);
create index if not exists idx_better_auth_account_user_id
  on account (user_id);
create index if not exists idx_better_auth_account_provider
  on account (provider_id, account_id);
create index if not exists idx_better_auth_verification_identifier
  on verification (identifier);

create index if not exists idx_auth_sessions_user_id
  on auth_sessions (user_id);
create index if not exists idx_agent_api_keys_hash_status
  on agent_api_keys (api_key_hash, status);
create index if not exists idx_agent_claims_token
  on agent_claims (claim_token);
create index if not exists idx_agent_claims_agent
  on agent_claims (agent_id);
create index if not exists idx_agents_claim_status
  on agents (claim_status, status);
create index if not exists idx_agent_accounts_competition
  on agent_accounts (competition_id);
create index if not exists idx_positions_agent_lookup
  on positions (agent_id, symbol, market);
create index if not exists idx_market_instruments_symbol_market
  on market_instruments (market, symbol);
create index if not exists idx_market_data_snapshots_instrument_quote_ts
  on market_data_snapshots (instrument_id, quote_ts desc);
create index if not exists idx_market_candles_lookup
  on market_candles (instrument_id, interval, open_time desc);
create index if not exists idx_detail_requests_window
  on detail_requests (agent_id, briefing_window_id);
create index if not exists idx_decision_submissions_agent_decision
  on decision_submissions (agent_id, decision_id);
create index if not exists idx_decision_submissions_agent_window
  on decision_submissions (agent_id, briefing_window_id);
create index if not exists idx_decision_actions_submission
  on decision_actions (submission_id);
create index if not exists idx_trade_executions_action
  on trade_executions (action_id);
create index if not exists idx_leaderboard_snapshots_agent_ts
  on leaderboard_snapshots (agent_id, snapshot_at desc);
create index if not exists idx_live_trade_events_agent_ts
  on live_trade_events (agent_id, executed_at desc);
create index if not exists idx_risk_events_agent_created
  on risk_events (agent_id, created_at desc);
create index if not exists idx_account_snapshots_agent_ts
  on account_snapshots (agent_id, ts desc);
create index if not exists idx_audit_logs_agent_created
  on audit_logs (agent_id, created_at desc);
create index if not exists idx_agent_briefings_agent_window
  on agent_briefings (agent_id, briefing_window_id);
create index if not exists idx_agent_protocol_events_agent_created
  on agent_protocol_events (agent_id, created_at desc);
create index if not exists idx_agent_protocol_events_endpoint_created
  on agent_protocol_events (endpoint_key, created_at desc);
create index if not exists idx_agent_error_reports_agent_created
  on agent_error_reports (agent_id, created_at desc);
create unique index if not exists idx_agent_daily_summaries_agent_date
  on agent_daily_summaries (agent_id, summary_date);
create index if not exists idx_system_actions_agent_created
  on system_actions (agent_id, created_at desc);

commit;
