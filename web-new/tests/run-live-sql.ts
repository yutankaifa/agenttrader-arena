import assert from 'node:assert/strict';
import type { Sql } from 'postgres';

let passed = 0;
let failed = 0;
const liveSqlOnly = process.env.AGENTTRADER_LIVE_SQL_ONLY?.trim().toLowerCase() ?? '';

function resolveLiveSqlUrl() {
  return (
    process.env.AGENTTRADER_LIVE_SQL_TEST_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    ''
  );
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  if (liveSqlOnly && !name.toLowerCase().includes(liveSqlOnly)) {
    console.log(`skip - ${name}`);
    return;
  }

  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function buildRunToken(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function buildDepthSnapshot(price: number, size = 1_000) {
  return JSON.stringify({
    bids: [{ price: Number((price - 0.5).toFixed(4)), size }],
    asks: [{ price: Number(price.toFixed(4)), size }],
    snapshot_at: new Date().toISOString(),
  });
}

function buildPredictionDepthSnapshot(
  bid: number,
  ask: number,
  size = 10_000
) {
  return JSON.stringify({
    bids: [{ price: Number(bid.toFixed(4)), size }],
    asks: [{ price: Number(ask.toFixed(4)), size }],
    snapshot_at: new Date().toISOString(),
  });
}

function buildRecentIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function ensureLiveSqlTables(sql: Sql) {
  const { ensureApplicationDatabaseSchema } = await import(
    new URL('../src/db/app-schema.ts', import.meta.url).href
  );
  await ensureApplicationDatabaseSchema();
  void sql;
  return;

  await sql`
    create table if not exists agents (
      id text primary key,
      name text,
      description text,
      x_url text,
      model_provider text,
      model_name text,
      runtime_environment text,
      strategy_hint text,
      status text,
      runner_status text,
      claim_status text,
      last_heartbeat_at timestamptz,
      updated_at timestamptz
    )
  `;
  await sql`
    create table if not exists runtime_configs (
      agent_id text primary key,
      heartbeat_interval_minutes integer,
      verified_at timestamptz,
      last_heartbeat_at timestamptz
    )
  `;
  await sql`
    create table if not exists competitions (
      id text primary key,
      name text,
      description text,
      status text,
      market_types text,
      rule_version text,
      start_at timestamptz,
      end_at timestamptz,
      created_at timestamptz
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
      updated_at timestamptz
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
      updated_at timestamptz
    )
  `;
  await sql`
    create table if not exists market_instruments (
      id text primary key,
      symbol text not null,
      market text not null,
      provider text not null,
      provider_market_id text,
      display_name text,
      metadata text,
      is_active boolean
    )
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
      outcome_id text
    )
  `;
  await sql`
    create table if not exists detail_requests (
      id text primary key,
      agent_id text not null,
      competition_id text not null,
      request_id text not null,
      decision_window_start timestamptz not null,
      briefing_window_id text not null,
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
    create table if not exists risk_events (
      id text primary key,
      agent_id text not null,
      competition_id text,
      event_type text not null,
      trigger_value numeric,
      threshold_value numeric,
      action_taken text,
      resolved_at timestamptz,
      created_at timestamptz not null
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
    create table if not exists audit_logs (
      id text primary key,
      agent_id text,
      event_type text not null,
      payload text,
      created_at timestamptz not null
    )
  `;
}

async function seedAgent(sql: Sql, input: {
  agentId: string;
  heartbeatAt: string;
  initialCash?: number;
  primaryMarket?: 'stock' | 'crypto' | 'prediction' | null;
  familiarSymbolsOrEventTypes?: string[];
  marketPreferences?: string[];
}) {
  const initialCash = input.initialCash ?? 100_000;
  const familiarSymbolsOrEventTypes = JSON.stringify(
    input.familiarSymbolsOrEventTypes ?? []
  );
  const marketPreferences = JSON.stringify(
    input.marketPreferences ??
      (input.primaryMarket ? [input.primaryMarket] : [])
  );
  await sql`
    insert into agents (
      id,
      name,
      description,
      x_url,
      primary_market,
      familiar_symbols_or_event_types,
      model_provider,
      model_name,
      runtime_environment,
      strategy_hint,
      risk_preference,
      market_preferences,
      status,
      runner_status,
      claim_status,
      last_heartbeat_at,
      updated_at
    ) values (
      ${input.agentId},
      ${`Live SQL ${input.agentId}`},
      ${'integration test agent'},
      ${null},
      ${input.primaryMarket ?? null},
      ${familiarSymbolsOrEventTypes},
      ${'openai'},
      ${'gpt-test'},
      ${'live-sql'},
      ${'integration'},
      ${'balanced'},
      ${marketPreferences},
      ${'active'},
      ${'ready'},
      ${'claimed'},
      ${input.heartbeatAt},
      ${input.heartbeatAt}
    )
    on conflict (id) do update set
      name = excluded.name,
      description = excluded.description,
      primary_market = excluded.primary_market,
      familiar_symbols_or_event_types = excluded.familiar_symbols_or_event_types,
      status = excluded.status,
      risk_preference = excluded.risk_preference,
      market_preferences = excluded.market_preferences,
      runner_status = excluded.runner_status,
      claim_status = excluded.claim_status,
      last_heartbeat_at = excluded.last_heartbeat_at,
      updated_at = excluded.updated_at
  `;
  await sql`
    insert into runtime_configs (
      agent_id,
      heartbeat_interval_minutes,
      verified_at,
      last_heartbeat_at
    ) values (
      ${input.agentId},
      ${15},
      ${input.heartbeatAt},
      ${input.heartbeatAt}
    )
    on conflict (agent_id) do update set
      heartbeat_interval_minutes = excluded.heartbeat_interval_minutes,
      verified_at = excluded.verified_at,
      last_heartbeat_at = excluded.last_heartbeat_at
  `;
  await sql`
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
      ${input.agentId},
      ${'comp_open_2026'},
      ${initialCash},
      ${initialCash},
      ${initialCash},
      ${initialCash},
      ${null},
      ${input.heartbeatAt}
    )
    on conflict (agent_id) do update set
      competition_id = excluded.competition_id,
      initial_cash = excluded.initial_cash,
      available_cash = excluded.available_cash,
      total_equity = excluded.total_equity,
      display_equity = excluded.display_equity,
      risk_tag = excluded.risk_tag,
      updated_at = excluded.updated_at
  `;
}

async function seedInstrumentAndMarketData(sql: Sql, input: {
  symbol: string;
  market: 'crypto';
  price: number;
}) {
  const quoteTs = buildRecentIso(-30_000);
  const candleOpen = buildRecentIso(-3_600_000);
  const candleClose = buildRecentIso(-1_800_000);
  const latestCandleOpen = buildRecentIso(-1_800_000);
  const latestCandleClose = buildRecentIso(-60_000);

  await sql`
    insert into market_instruments (
      id,
      symbol,
      market,
      provider,
      provider_market_id,
      display_name,
      metadata,
      is_active
    ) values (
      ${input.symbol},
      ${input.symbol},
      ${input.market},
      ${'integration-feed'},
      ${null},
      ${input.symbol},
      ${null},
      ${true}
    )
    on conflict (id) do update set
      symbol = excluded.symbol,
      market = excluded.market,
      provider = excluded.provider,
      display_name = excluded.display_name,
      metadata = excluded.metadata,
      is_active = excluded.is_active
  `;
  await sql`
    insert into market_data_snapshots (
      id,
      instrument_id,
      provider,
      quote_ts,
      last_price,
      bid,
      ask,
      midpoint,
      spread,
      bid_size,
      ask_size,
      depth_snapshot,
      raw_payload
    ) values (
      ${`${input.symbol}_quote`},
      ${input.symbol},
      ${'integration-feed'},
      ${quoteTs},
      ${input.price},
      ${input.price - 0.5},
      ${input.price},
      ${input.price - 0.25},
      ${0.5},
      ${1_000},
      ${1_000},
      ${buildDepthSnapshot(input.price)},
      ${null}
    )
    on conflict (id) do update set
      quote_ts = excluded.quote_ts,
      last_price = excluded.last_price,
      bid = excluded.bid,
      ask = excluded.ask,
      midpoint = excluded.midpoint,
      spread = excluded.spread,
      bid_size = excluded.bid_size,
      ask_size = excluded.ask_size,
      depth_snapshot = excluded.depth_snapshot
  `;
  await sql`
    insert into market_candles (
      id,
      instrument_id,
      interval,
      open_time,
      close_time,
      open,
      high,
      low,
      close,
      volume,
      trade_count,
      vwap,
      outcome_id
    ) values
    (
      ${`${input.symbol}_candle_1`},
      ${input.symbol},
      ${'1h'},
      ${candleOpen},
      ${candleClose},
      ${input.price - 3},
      ${input.price - 1},
      ${input.price - 5},
      ${input.price - 2},
      ${500},
      ${null},
      ${input.price - 2.5},
      ${null}
    ),
    (
      ${`${input.symbol}_candle_2`},
      ${input.symbol},
      ${'1h'},
      ${latestCandleOpen},
      ${latestCandleClose},
      ${input.price - 2},
      ${input.price + 1},
      ${input.price - 3},
      ${input.price},
      ${650},
      ${null},
      ${input.price - 0.5},
      ${null}
    )
    on conflict (id) do update set
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      vwap = excluded.vwap
  `;
}

async function seedPredictionInstrumentAndMarketData(sql: Sql, input: {
  symbol: string;
  title: string;
  yesOutcomeId: string;
  noOutcomeId: string;
  yesPrice: number;
  noPrice: number;
}) {
  const quoteTs = buildRecentIso(-5_000);
  const candleOpen = buildRecentIso(-3_600_000);
  const candleClose = buildRecentIso(-1_800_000);
  const latestCandleOpen = buildRecentIso(-1_800_000);
  const latestCandleClose = buildRecentIso(-60_000);
  const yesBid = Number((input.yesPrice - 0.01).toFixed(4));
  const yesAsk = Number(input.yesPrice.toFixed(4));
  const noBid = Number((input.noPrice - 0.01).toFixed(4));
  const noAsk = Number(input.noPrice.toFixed(4));
  const metadata = JSON.stringify({
    active: true,
    closed: false,
    acceptingOrders: true,
    marketStatus: 'active',
    resolvesAt: buildRecentIso(7 * 24 * 60 * 60 * 1000),
    resolvedOutcomeId: null,
    outcomes: [
      {
        id: input.yesOutcomeId,
        name: 'Yes',
        price: input.yesPrice,
      },
      {
        id: input.noOutcomeId,
        name: 'No',
        price: input.noPrice,
      },
    ],
    title: input.title,
    description: 'Integration-test prediction market.',
    eventTitle: input.title,
    category: 'Economy',
    archived: false,
    liquidity: 500_000,
    volume24h: 125_000,
    rules: 'Resolves to the matching outcome for the integration test.',
    resolutionSource: 'integration-test',
    clobTokenIds: [input.yesOutcomeId, input.noOutcomeId],
  });

  await sql`
    insert into market_instruments (
      id,
      symbol,
      market,
      provider,
      provider_market_id,
      display_name,
      metadata,
      is_active
    ) values (
      ${input.symbol},
      ${input.symbol},
      ${'prediction'},
      ${'integration-feed'},
      ${`${input.symbol}_condition`},
      ${input.title},
      ${metadata},
      ${true}
    )
    on conflict (id) do update set
      symbol = excluded.symbol,
      market = excluded.market,
      provider = excluded.provider,
      provider_market_id = excluded.provider_market_id,
      display_name = excluded.display_name,
      metadata = excluded.metadata,
      is_active = excluded.is_active
  `;

  await sql`
    insert into market_data_snapshots (
      id,
      instrument_id,
      provider,
      quote_ts,
      last_price,
      bid,
      ask,
      midpoint,
      spread,
      bid_size,
      ask_size,
      depth_snapshot,
      raw_payload
    ) values
    (
      ${`${input.symbol}_yes_quote`},
      ${`${input.symbol}::${input.yesOutcomeId}`},
      ${'integration-feed'},
      ${quoteTs},
      ${input.yesPrice},
      ${yesBid},
      ${yesAsk},
      ${Number(((yesBid + yesAsk) / 2).toFixed(4))},
      ${Number((yesAsk - yesBid).toFixed(4))},
      ${10_000},
      ${10_000},
      ${buildPredictionDepthSnapshot(yesBid, yesAsk)},
      ${null}
    ),
    (
      ${`${input.symbol}_no_quote`},
      ${`${input.symbol}::${input.noOutcomeId}`},
      ${'integration-feed'},
      ${quoteTs},
      ${input.noPrice},
      ${noBid},
      ${noAsk},
      ${Number(((noBid + noAsk) / 2).toFixed(4))},
      ${Number((noAsk - noBid).toFixed(4))},
      ${10_000},
      ${10_000},
      ${buildPredictionDepthSnapshot(noBid, noAsk)},
      ${null}
    )
    on conflict (id) do update set
      instrument_id = excluded.instrument_id,
      quote_ts = excluded.quote_ts,
      last_price = excluded.last_price,
      bid = excluded.bid,
      ask = excluded.ask,
      midpoint = excluded.midpoint,
      spread = excluded.spread,
      bid_size = excluded.bid_size,
      ask_size = excluded.ask_size,
      depth_snapshot = excluded.depth_snapshot
  `;

  await sql`
    insert into market_candles (
      id,
      instrument_id,
      interval,
      open_time,
      close_time,
      open,
      high,
      low,
      close,
      volume,
      trade_count,
      vwap,
      outcome_id
    ) values
    (
      ${`${input.symbol}_candle_1`},
      ${input.symbol},
      ${'1h'},
      ${candleOpen},
      ${candleClose},
      ${0.39},
      ${0.42},
      ${0.37},
      ${0.41},
      ${25000},
      ${null},
      ${0.4025},
      ${null}
    ),
    (
      ${`${input.symbol}_candle_2`},
      ${input.symbol},
      ${'1h'},
      ${latestCandleOpen},
      ${latestCandleClose},
      ${0.41},
      ${0.44},
      ${0.4},
      ${0.43},
      ${31000},
      ${null},
      ${0.425},
      ${null}
    )
    on conflict (id) do update set
      instrument_id = excluded.instrument_id,
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      vwap = excluded.vwap,
      outcome_id = excluded.outcome_id
  `;
}

async function cleanupScenario(sql: Sql, input: {
  agentId: string;
  symbols: string[];
}) {
  await sql`
    delete from trade_executions
    where action_id in (
      select da.id
      from decision_actions da
      inner join decision_submissions ds on ds.id = da.submission_id
      where ds.agent_id = ${input.agentId}
    )
  `;
  await sql`
    delete from live_trade_events
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from risk_events
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from decision_actions
    where submission_id in (
      select id
      from decision_submissions
      where agent_id = ${input.agentId}
    )
  `;
  await sql`
    delete from decision_window_consumptions
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from decision_submissions
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from detail_requests
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from agent_briefings
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from agent_protocol_events
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from account_snapshots
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from leaderboard_snapshots
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from positions
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from agent_accounts
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from runtime_configs
    where agent_id = ${input.agentId}
  `;
  await sql`
    delete from agents
    where id = ${input.agentId}
  `;
  for (const symbol of input.symbols) {
    await sql`
      delete from market_candles
      where instrument_id = ${symbol}
         or instrument_id like ${`${symbol}::%`}
    `;
    await sql`
      delete from market_data_snapshots
      where instrument_id = ${symbol}
         or instrument_id like ${`${symbol}::%`}
    `;
    await sql`
      delete from market_instruments
      where id = ${symbol}
         or symbol = ${symbol}
    `;
  }
}

async function main() {
  const liveSqlUrl = resolveLiveSqlUrl();
  if (!liveSqlUrl) {
    if (process.env.AGENTTRADER_LIVE_SQL_REQUIRED === '1') {
      throw new Error(
        'Live SQL tests require AGENTTRADER_LIVE_SQL_TEST_URL or DATABASE_URL'
      );
    }

    console.log(
      'ok - live SQL tests skipped (set AGENTTRADER_LIVE_SQL_TEST_URL or DATABASE_URL)'
    );
    return;
  }

  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.DATABASE_URL = liveSqlUrl;
  mutableEnv.NODE_ENV = 'test';
  mutableEnv.AGENTTRADER_MARKET_DATA_MODE = 'sim';

  const [
    { getSqlClient },
    { submitDetailRequest },
    { submitDecision },
    { getBriefingWindowId },
    { buildAgentBriefing },
    { writeAgentBriefing },
    { buildDecisionPersistencePlan },
    { writeDecisionPersistencePlan },
  ] = await Promise.all([
    import(new URL('../src/db/postgres.ts', import.meta.url).href),
    import(new URL('../src/lib/agent-detail-request-service.ts', import.meta.url).href),
    import(new URL('../src/lib/agent-decision-service.ts', import.meta.url).href),
    import(new URL('../src/lib/trading-rules.ts', import.meta.url).href),
    import(new URL('../src/lib/agent-briefing.ts', import.meta.url).href),
    import(new URL('../src/lib/agent-events.ts', import.meta.url).href),
    import(new URL('../src/lib/agent-persistence-plan.ts', import.meta.url).href),
    import(new URL('../src/lib/agent-persistence-db.ts', import.meta.url).href),
  ]);

  const sql = getSqlClient();
  await ensureLiveSqlTables(sql);

  await runTest(
    'submitDetailRequest uses real SQL quote/candle state and persists one window-limited record',
    async () => {
      const token = buildRunToken('detail');
      const agentId = `agt_${token}`;
      const symbol = `LIVESQL_${token.toUpperCase()}_CRYPTO`;
      const heartbeatAt = buildRecentIso(-10_000);
      const windowId = getBriefingWindowId(heartbeatAt);
      assert.ok(windowId, 'expected a valid briefing window');

      await cleanupScenario(sql, { agentId, symbols: [symbol] });
      try {
        await seedAgent(sql, { agentId, heartbeatAt });
        await seedInstrumentAndMarketData(sql, {
          symbol,
          market: 'crypto',
          price: 42_000,
        });

        const result = await submitDetailRequest(agentId, {
          type: 'detail_request',
          request_id: `req_${token}`,
          window_id: windowId,
          market: 'crypto',
          scope: 'market',
          reason:
            'Need a full quote and candle view before sizing this crypto market for the current window.',
          objects: [`crypto:${symbol}`],
        });

        assert.equal(result.ok, true);
        if (!result.ok) {
          return;
        }

        assert.equal(result.data.request_id, `req_${token}`);
        assert.equal(result.data.window_id, windowId);
        assert.equal(result.data.objects.length, 1);
        assert.equal(result.data.objects[0].symbol, symbol);
        assert.equal(result.data.objects[0].quote_source, 'db');
        assert.equal(result.data.objects[0].candles_source, 'db');
        assert.equal(Number(result.data.objects[0].quote?.last_price ?? 0), 42_000);

        const detailRows = await sql<
          {
            request_id: string;
            briefing_window_id: string;
            response_summary: string;
          }[]
        >`
          select request_id, briefing_window_id, response_summary
          from detail_requests
          where agent_id = ${agentId}
        `;
        assert.equal(detailRows.length, 1);
        assert.equal(detailRows[0].request_id, `req_${token}`);
        assert.equal(detailRows[0].briefing_window_id, windowId);
        assert.match(detailRows[0].response_summary, new RegExp(symbol));

        const protocolRows = await sql<
          {
            endpoint_key: string;
            request_payload: string | null;
            response_payload: string | null;
            request_success: boolean;
          }[]
        >`
          select endpoint_key, request_payload, response_payload, request_success
          from agent_protocol_events
          where agent_id = ${agentId}
          order by created_at asc
        `;
        assert.equal(protocolRows.length, 1);
        assert.equal(protocolRows[0].endpoint_key, 'detail_request');
        assert.equal(protocolRows[0].request_success, true);
        assert.match(protocolRows[0].request_payload ?? '', new RegExp(`req_${token}`));
        assert.match(protocolRows[0].response_payload ?? '', new RegExp(symbol));

        const limited = await submitDetailRequest(agentId, {
          type: 'detail_request',
          request_id: `req_${token}_2`,
          window_id: windowId,
          market: 'crypto',
          scope: 'market',
          reason:
            'Requesting a second detail payload in the same window should be rate limited by SQL state.',
          objects: [`crypto:${symbol}`],
        });

        assert.equal(limited.ok, false);
        if (limited.ok) {
          return;
        }
        assert.equal(limited.code, 'RATE_LIMIT');
        assert.equal(limited.status, 429);
      } finally {
        await cleanupScenario(sql, { agentId, symbols: [symbol] });
      }
    }
  );

  await runTest(
    'submitDecision executes a real SQL-backed crypto buy and records execution artifacts',
    async () => {
      const token = buildRunToken('decision');
      const agentId = `agt_${token}`;
      const symbol = `LIVESQL_${token.toUpperCase()}_CRYPTO`;
      const heartbeatAt = buildRecentIso(-10_000);
      const windowId = getBriefingWindowId(heartbeatAt);
      assert.ok(windowId, 'expected a valid briefing window');

      await cleanupScenario(sql, { agentId, symbols: [symbol] });
      try {
        await seedAgent(sql, { agentId, heartbeatAt });
        await seedInstrumentAndMarketData(sql, {
          symbol,
          market: 'crypto',
          price: 50,
        });

        const result = await submitDecision(agentId, {
          type: 'decision',
          decision_id: `dec_${token}`,
          window_id: windowId,
          decision_rationale:
            'Market structure supports a small starter position while cash remains ample and risk stays controlled.',
          actions: [
            {
              action_id: `act_${token}`,
              action: 'buy',
              market: 'crypto',
              object_id: `crypto:${symbol}`,
              amount_usd: 1_000,
              reason_tag: 'trend follow',
              reasoning_summary:
                'Momentum remains constructive while the order size stays small versus equity, so buying this market keeps risk controlled.',
            },
          ],
        });

        assert.equal(result.ok, true);
        if (!result.ok) {
          return;
        }

        assert.equal(result.data.execution_status, 'executed');
        assert.equal(result.data.actions.length, 1);
        assert.equal(result.data.actions[0].status, 'filled');
        assert.match(result.data.actions[0].quote_source ?? '', /^db:/);
        assert.equal(result.data.actions[0].fill_price, 50);

        const submissionRows = await sql<
          {
            id: string;
            status: string;
            rejection_reason: string | null;
          }[]
        >`
          select id, status, rejection_reason
          from decision_submissions
          where agent_id = ${agentId}
            and decision_id = ${`dec_${token}`}
        `;
        assert.equal(submissionRows.length, 1);
        assert.equal(submissionRows[0].status, 'accepted');
        assert.equal(submissionRows[0].rejection_reason, null);

        const actionRows = await sql<
          {
            id: string;
            status: string;
            requested_units: number | null;
          }[]
        >`
          select id, status, requested_units
          from decision_actions
          where submission_id = ${submissionRows[0].id}
        `;
        assert.equal(actionRows.length, 1);
        assert.equal(actionRows[0].status, 'filled');
        assert.ok((actionRows[0].requested_units ?? 0) > 0);

        const executionRows = await sql<
          {
            filled_units: number | null;
            quote_source: string | null;
            execution_method: string | null;
          }[]
        >`
          select filled_units, quote_source, execution_method
          from trade_executions
          where action_id = ${actionRows[0].id}
        `;
        assert.equal(executionRows.length, 1);
        assert.ok((executionRows[0].filled_units ?? 0) > 0);
        assert.match(executionRows[0].quote_source ?? '', /^db:/);
        assert.equal(executionRows[0].execution_method, 'walk_book');

        const positionRows = await sql<
          {
            position_size: number | null;
            entry_price: number | null;
          }[]
        >`
          select position_size, entry_price
          from positions
          where agent_id = ${agentId}
            and symbol = ${symbol}
            and market = 'crypto'
        `;
        assert.equal(positionRows.length, 1);
        assert.ok((positionRows[0].position_size ?? 0) > 0);
        assert.equal(Number(positionRows[0].entry_price ?? 0), 50);

        const accountRows = await sql<
          {
            available_cash: number | null;
            display_equity: number | null;
          }[]
        >`
          select available_cash, display_equity
          from agent_accounts
          where agent_id = ${agentId}
        `;
        assert.equal(accountRows.length, 1);
        assert.ok(Number(accountRows[0].available_cash ?? 0) < 100_000);
        assert.ok(Number(accountRows[0].display_equity ?? 0) > 0);

        const liveTradeRows = await sql<{ total: number }[]>`
          select count(*)::int as total
          from live_trade_events
          where agent_id = ${agentId}
        `;
        assert.equal(Number(liveTradeRows[0]?.total ?? 0), 1);

        const protocolRows = await sql<
          {
            endpoint_key: string;
            decision_id: string | null;
            request_payload: string | null;
            response_payload: string | null;
          }[]
        >`
          select endpoint_key, decision_id, request_payload, response_payload
          from agent_protocol_events
          where agent_id = ${agentId}
          order by created_at asc
        `;
        assert.equal(protocolRows.length, 1);
        assert.equal(protocolRows[0].endpoint_key, 'decision');
        assert.equal(protocolRows[0].decision_id, `dec_${token}`);
        assert.match(protocolRows[0].request_payload ?? '', new RegExp(`dec_${token}`));
        assert.match(protocolRows[0].response_payload ?? '', /executed/);

        const duplicate = await submitDecision(agentId, {
          type: 'decision',
          decision_id: `dec_${token}`,
          window_id: windowId,
          decision_rationale:
            'Reusing the same decision id in the same SQL-backed window must be rejected.',
          actions: [
            {
              action_id: `act_${token}_duplicate`,
              action: 'buy',
              market: 'crypto',
              object_id: `crypto:${symbol}`,
              amount_usd: 500,
              reason_tag: 'trend follow',
              reasoning_summary:
                'The duplicate request is intentional and should be blocked by persisted decision history.',
            },
          ],
        });

        assert.equal(duplicate.ok, false);
        if (duplicate.ok) {
          return;
        }
        assert.equal(duplicate.code, 'DUPLICATE_DECISION');
        assert.equal(duplicate.status, 409);
      } finally {
        await cleanupScenario(sql, { agentId, symbols: [symbol] });
      }
    }
  );

  await runTest(
    'submitDecision treats a rejected submission as consuming the briefing window',
    async () => {
      const token = buildRunToken('window_consumed');
      const agentId = `agt_${token}`;
      const symbol = `LIVESQL_${token.toUpperCase()}_CRYPTO`;
      const heartbeatAt = buildRecentIso(-10_000);
      const windowId = getBriefingWindowId(heartbeatAt);
      assert.ok(windowId, 'expected a valid briefing window');

      await cleanupScenario(sql, { agentId, symbols: [symbol] });
      try {
        await seedAgent(sql, { agentId, heartbeatAt });
        await seedInstrumentAndMarketData(sql, {
          symbol,
          market: 'crypto',
          price: 50,
        });

        let counter = 0;
        const rejectedPlan = buildDecisionPersistencePlan({
          createId: (prefix: 'sub' | 'action' | 'detail') => {
            counter += 1;
            return `${prefix}_${token}_${counter}`;
          },
          decisionId: `dec_rejected_${token}`,
          agentId,
          competitionId: 'comp_open_2026',
          decisionRationale:
            'This rejected submission is seeded to prove that any prior decision must consume the entire briefing window.',
          windowId,
          status: 'rejected',
          rejectionReason: 'SEEDED_REJECTED_DECISION',
          receivedAt: buildRecentIso(-5_000),
          actions: [
            {
              action_id: `act_rejected_${token}`,
              side: 'buy',
              market: 'crypto',
              symbol,
              object_id: `crypto:${symbol}`,
              amount_usd: 500,
              reason_tag: 'seeded reject',
              reasoning_summary:
                'This seeded rejection exists only to reserve the decision window for the integration test.',
              event_id: null,
              outcome_id: null,
              outcome_name: null,
            },
          ],
        });
        await writeDecisionPersistencePlan(sql, rejectedPlan);

        const blocked = await submitDecision(agentId, {
          type: 'decision',
          decision_id: `dec_second_${token}`,
          window_id: windowId,
          decision_rationale:
            'A second submission in the same window must be rejected even when the earlier one finished as rejected.',
          actions: [
            {
              action_id: `act_second_${token}`,
              action: 'buy',
              market: 'crypto',
              object_id: `crypto:${symbol}`,
              amount_usd: 500,
              reason_tag: 'follow up',
              reasoning_summary:
                'Trying again in the same window should fail because the prior rejected submission already consumed it.',
            },
          ],
        });

        assert.equal(blocked.ok, false);
        if (blocked.ok) {
          return;
        }

        assert.equal(blocked.code, 'DECISION_WINDOW_LIMIT');
        assert.equal(blocked.status, 409);
      } finally {
        await cleanupScenario(sql, { agentId, symbols: [symbol] });
      }
    }
  );

  await runTest(
    'prediction briefing -> detail-request -> decision executes a real SQL-backed outcome buy',
    async () => {
      const token = buildRunToken('prediction');
      const agentId = `agt_${token}`;
      const symbol = `fed_live_sql_${token}`;
      const yesOutcomeId = `${symbol}_yes`;
      const noOutcomeId = `${symbol}_no`;
      const heartbeatAt = buildRecentIso(-10_000);
      const windowId = getBriefingWindowId(heartbeatAt);
      assert.ok(windowId, 'expected a valid briefing window');

      await cleanupScenario(sql, { agentId, symbols: [symbol] });
      try {
        await seedAgent(sql, {
          agentId,
          heartbeatAt,
          primaryMarket: 'prediction',
          familiarSymbolsOrEventTypes: [symbol],
          marketPreferences: ['prediction'],
        });
        await seedPredictionInstrumentAndMarketData(sql, {
          symbol,
          title: 'Will the Fed cut rates in this integration test?',
          yesOutcomeId,
          noOutcomeId,
          yesPrice: 0.43,
          noPrice: 0.57,
        });

        const briefing = await buildAgentBriefing(
          agentId,
          new Date(heartbeatAt),
          'active'
        );
        await writeAgentBriefing({
          agentId,
          briefingWindowId: briefing?.risk_status?.decision_window?.id ?? null,
          payload: briefing,
          createdAt: new Date(heartbeatAt),
        });

        assert.equal(briefing.risk_status.decision_window.id, windowId);
        assert.equal(
          briefing.market_signal_summary.prediction.top_markets.length > 0,
          true
        );
        assert.equal(
          briefing.market_signal_summary.prediction.top_markets[0]?.symbol,
          symbol
        );
        assert.equal(
          briefing.market_signal_summary.prediction.top_markets[0]?.outcomes.some(
            (outcome: { object_id: string; execution_allowed: boolean }) =>
              outcome.object_id === `pm:${symbol}:YES` && outcome.execution_allowed
          ),
          true
        );

        const detail = await submitDetailRequest(agentId, {
          type: 'detail_request',
          request_id: `req_${token}`,
          window_id: windowId,
          market: 'prediction',
          scope: 'market',
          reason:
            'Need the current outcome-level quote quality and execution whitelist before placing a prediction trade in this window.',
          objects: [`pm:${symbol}`],
        });

        assert.equal(detail.ok, true);
        if (!detail.ok) {
          return;
        }

        assert.equal(detail.data.objects.length, 1);
        assert.equal(detail.data.objects[0].market, 'prediction');
        assert.equal(detail.data.objects[0].event_id, symbol);
        assert.equal(
          detail.data.objects[0].blocked_reason,
          'SELECT_TRADABLE_OUTCOME_REQUIRED'
        );
        assert.equal(
          detail.data.objects[0].decision_allowed_objects.some(
            (candidate: { object_id: string; outcome_id: string | null }) =>
              candidate.object_id === `pm:${symbol}:YES` &&
              candidate.outcome_id === yesOutcomeId
          ),
          true
        );

        const decision = await submitDecision(agentId, {
          type: 'decision',
          decision_id: `dec_${token}`,
          window_id: windowId,
          decision_rationale:
            'The stored detail response confirms that the YES outcome is currently decision-allowed with reliable top-of-book data, so a small starter position is acceptable in this window.',
          actions: [
            {
              action_id: `act_${token}`,
              action: 'buy',
              market: 'prediction',
              object_id: `pm:${symbol}:YES`,
              amount_usd: 1_000,
              reason_tag: 'policy repricing',
              reasoning_summary:
                'The current detail payload whitelists the YES outcome, top-of-book is internally consistent, and the position size remains small versus available cash and concentration limits.',
            },
          ],
        });

        assert.equal(
          decision.ok,
          true,
          decision.ok ? undefined : JSON.stringify(decision, null, 2)
        );
        if (!decision.ok) {
          return;
        }

        assert.equal(decision.data.execution_status, 'executed');
        assert.equal(decision.data.actions.length, 1);
        assert.equal(decision.data.actions[0].status, 'filled');
        assert.equal(decision.data.actions[0].market, 'prediction');
        assert.equal(decision.data.actions[0].object_id, `pm:${symbol}:YES`);
        assert.equal(decision.data.actions[0].external_token_id, yesOutcomeId);
        assert.equal(decision.data.actions[0].fill_price, 0.43);
        assert.match(decision.data.actions[0].quote_source ?? '', /^db:/);

        const briefingRows = await sql<{ total: number }[]>`
          select count(*)::int as total
          from agent_briefings
          where agent_id = ${agentId}
        `;
        assert.equal(Number(briefingRows[0]?.total ?? 0), 1);

        const protocolRows = await sql<
          {
            endpoint_key: string;
            http_method: string;
            request_payload: string | null;
            response_payload: string | null;
            request_success: boolean;
          }[]
        >`
          select endpoint_key, http_method, request_payload, response_payload, request_success
          from agent_protocol_events
          where agent_id = ${agentId}
          order by created_at asc
        `;
        assert.equal(protocolRows.length, 3);
        const protocolByEndpoint = new Map<
          string,
          {
            endpoint_key: string;
            http_method: string;
            request_payload: string | null;
            response_payload: string | null;
            request_success: boolean;
          }
        >(
          protocolRows.map(
            (row: {
              endpoint_key: string;
              http_method: string;
              request_payload: string | null;
              response_payload: string | null;
              request_success: boolean;
            }) => [row.endpoint_key, row] as const
          )
        );
        assert.equal(protocolByEndpoint.has('briefing'), true);
        assert.equal(protocolByEndpoint.has('detail_request'), true);
        assert.equal(protocolByEndpoint.has('decision'), true);
        assert.equal(protocolByEndpoint.get('briefing')?.http_method, 'GET');
        assert.equal(protocolByEndpoint.get('briefing')?.request_success, true);
        assert.equal(protocolByEndpoint.get('briefing')?.request_payload, null);
        assert.match(protocolByEndpoint.get('briefing')?.response_payload ?? '', /success/);
        assert.match(
          protocolByEndpoint.get('detail_request')?.request_payload ?? '',
          new RegExp(`req_${token}`)
        );
        assert.match(
          protocolByEndpoint.get('decision')?.request_payload ?? '',
          new RegExp(`dec_${token}`)
        );

        const detailRows = await sql<
          {
            request_id: string;
            briefing_window_id: string;
            response_summary: string;
          }[]
        >`
          select request_id, briefing_window_id, response_summary
          from detail_requests
          where agent_id = ${agentId}
        `;
        assert.equal(detailRows.length, 1);
        assert.equal(detailRows[0].request_id, `req_${token}`);
        assert.equal(detailRows[0].briefing_window_id, windowId);
        assert.match(detailRows[0].response_summary, new RegExp(`pm:${symbol}:YES`));

        const submissionRows = await sql<
          {
            id: string;
            status: string;
            rejection_reason: string | null;
          }[]
        >`
          select id, status, rejection_reason
          from decision_submissions
          where agent_id = ${agentId}
            and decision_id = ${`dec_${token}`}
        `;
        assert.equal(submissionRows.length, 1);
        assert.equal(submissionRows[0].status, 'accepted');
        assert.equal(submissionRows[0].rejection_reason, null);

        const actionRows = await sql<
          {
            id: string;
            status: string;
            outcome_id: string | null;
            event_id: string | null;
          }[]
        >`
          select id, status, outcome_id, event_id
          from decision_actions
          where submission_id = ${submissionRows[0].id}
        `;
        assert.equal(actionRows.length, 1);
        assert.equal(actionRows[0].status, 'filled');
        assert.equal(actionRows[0].outcome_id, yesOutcomeId);
        assert.equal(actionRows[0].event_id, symbol);

        const executionRows = await sql<
          {
            fill_price: number | null;
            quote_source: string | null;
            execution_method: string | null;
          }[]
        >`
          select fill_price, quote_source, execution_method
          from trade_executions
          where action_id = ${actionRows[0].id}
        `;
        assert.equal(executionRows.length, 1);
        assert.equal(Number(executionRows[0].fill_price ?? 0), 0.43);
        assert.match(executionRows[0].quote_source ?? '', /^db:/);
        assert.equal(executionRows[0].execution_method, 'walk_book');

        const positionRows = await sql<
          {
            event_id: string | null;
            outcome_id: string | null;
            outcome_name: string | null;
            position_size: number | null;
            entry_price: number | null;
          }[]
        >`
          select event_id, outcome_id, outcome_name, position_size, entry_price
          from positions
          where agent_id = ${agentId}
            and symbol = ${symbol}
            and market = 'prediction'
        `;
        assert.equal(positionRows.length, 1);
        assert.equal(positionRows[0].event_id, symbol);
        assert.equal(positionRows[0].outcome_id, yesOutcomeId);
        assert.equal(positionRows[0].outcome_name, 'Yes');
        assert.ok((positionRows[0].position_size ?? 0) > 0);
        assert.equal(Number(positionRows[0].entry_price ?? 0), 0.43);

        const liveTradeRows = await sql<{ total: number }[]>`
          select count(*)::int as total
          from live_trade_events
          where agent_id = ${agentId}
        `;
        assert.equal(Number(liveTradeRows[0]?.total ?? 0), 1);
      } finally {
        await cleanupScenario(sql, { agentId, symbols: [symbol] });
      }
    }
  );

  const end = (sql as Sql & { end?: (options?: { timeout?: number }) => Promise<void> }).end;
  if (typeof end === 'function') {
    await end.call(sql, { timeout: 1 });
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
