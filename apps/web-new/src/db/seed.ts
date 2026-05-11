import type {
  Account,
  AccountSnapshot,
  Agent,
  AgentAccount,
  AgentApiKey,
  AgentClaim,
  AgentDailySummary,
  AgentTraderStore,
  Competition,
  DecisionAction,
  DecisionSubmission,
  LeaderboardSnapshot,
  LiveTradeEvent,
  MarketCandle,
  MarketDataSnapshot,
  MarketInstrument,
  Position,
  RuntimeConfig,
  SystemAction,
  TradeExecution,
  User,
} from '@/db/schema';
import {
  COMPETITION_PHASE,
  LEADERBOARD_MIN_EXECUTED_ACTIONS,
} from '@/lib/trading-rules';

function iso(date: Date) {
  return date.toISOString();
}

function hoursAgo(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function minutesAgo(now: Date, minutes: number) {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function buildCandles(
  instrumentId: string,
  symbol: string,
  market: MarketInstrument['market'],
  basePrice: number,
  count: number,
  now: Date,
  outcomeId: string | null = null
) {
  const candles: MarketCandle[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const openTime = hoursAgo(now, index + 1);
    const closeTime = hoursAgo(now, index);
    const drift = Math.sin(index / 2.7) * basePrice * 0.015;
    const open = round(basePrice + drift - basePrice * 0.005);
    const close = round(basePrice + drift + basePrice * 0.004);
    const high = round(Math.max(open, close) * 1.006);
    const low = round(Math.min(open, close) * 0.994);
    candles.push({
      id: `${instrumentId}_candle_${index}_${outcomeId ?? 'spot'}`,
      instrumentId,
      market,
      symbol,
      interval: '1h',
      openTime: iso(openTime),
      closeTime: iso(closeTime),
      open,
      high,
      low,
      close,
      volume: market === 'prediction' ? null : Math.round(5000 + index * 220),
      tradeCount: market === 'prediction' ? null : 100 + index * 3,
      vwap: round((open + close) / 2),
      outcomeId,
    });
  }
  return candles;
}

function buildAccountSeries(
  agentId: string,
  initialCash: number,
  latestEquity: number,
  now: Date
) {
  const points: AccountSnapshot[] = [];
  const slope = (latestEquity - initialCash) / 24;
  let peak = 0;

  for (let index = 23; index >= 0; index -= 1) {
    const equity = round(initialCash + slope * (24 - index) + Math.sin(index) * 680);
    peak = Math.max(peak, equity);
    const drawdown = round(((equity - peak) / peak) * 100);
    points.push({
      id: `${agentId}_snap_${index}`,
      agentId,
      ts: iso(hoursAgo(now, index)),
      cash: round(equity * 0.42),
      equity,
      drawdown,
      returnRate: round(((equity - initialCash) / initialCash) * 100),
    });
  }

  return points;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function countSeedExecutedActions(
  agentId: string,
  submissions: DecisionSubmission[],
  actions: DecisionAction[]
) {
  const submissionIds = new Set(
    submissions.filter((item) => item.agentId === agentId).map((item) => item.id)
  );

  return actions.filter(
    (item) =>
      submissionIds.has(item.submissionId) &&
      (item.status === 'filled' || item.status === 'partial')
  ).length;
}

export function buildSeedStore(now = new Date()): AgentTraderStore {
  const userAlice: User = {
    id: 'user_alice',
    name: 'Alice Arena',
    email: 'alice@example.test',
    emailVerified: true,
    image: null,
    createdAt: iso(hoursAgo(now, 240)),
    updatedAt: iso(hoursAgo(now, 12)),
  };
  const userBruno: User = {
    id: 'user_bruno',
    name: 'Bruno Basis',
    email: 'bruno@example.test',
    emailVerified: true,
    image: null,
    createdAt: iso(hoursAgo(now, 240)),
    updatedAt: iso(hoursAgo(now, 10)),
  };

  const competition: Competition = {
    id: 'comp_open_2026',
    name: 'AgentTrader Open Season',
    description: 'Cross-market simulation across stocks, crypto, and prediction markets.',
    status: 'active',
    marketTypes: ['stock', 'crypto', 'prediction'],
    ruleVersion: '1.0',
    startAt: iso(hoursAgo(now, 24 * 15)),
    endAt: null,
    createdAt: iso(hoursAgo(now, 24 * 30)),
  };

  const instruments: MarketInstrument[] = [
    {
      id: 'inst_aapl',
      market: 'stock',
      symbol: 'AAPL',
      displayName: 'Apple Inc.',
      provider: 'sim-market',
      providerSymbol: 'AAPL',
      providerMarketId: null,
      assetId: null,
      isActive: true,
      metadata: { active: true, closed: false, marketStatus: 'open' },
    },
    {
      id: 'inst_nvda',
      market: 'stock',
      symbol: 'NVDA',
      displayName: 'NVIDIA Corp.',
      provider: 'sim-market',
      providerSymbol: 'NVDA',
      providerMarketId: null,
      assetId: null,
      isActive: true,
      metadata: { active: true, closed: false, marketStatus: 'open' },
    },
    {
      id: 'inst_btc',
      market: 'crypto',
      symbol: 'BTC',
      displayName: 'Bitcoin',
      provider: 'sim-market',
      providerSymbol: 'BTCUSDT',
      providerMarketId: null,
      assetId: null,
      isActive: true,
      metadata: { active: true, closed: false, marketStatus: 'open' },
    },
    {
      id: 'inst_eth',
      market: 'crypto',
      symbol: 'ETH',
      displayName: 'Ethereum',
      provider: 'sim-market',
      providerSymbol: 'ETHUSDT',
      providerMarketId: null,
      assetId: null,
      isActive: true,
      metadata: { active: true, closed: false, marketStatus: 'open' },
    },
    {
      id: 'inst_us_rate_cut',
      market: 'prediction',
      symbol: 'US_RATE_CUT_Q3',
      displayName: 'Will the Fed cut before Q3?',
      provider: 'sim-market',
      providerSymbol: 'US_RATE_CUT_Q3',
      providerMarketId: 'pm_us_rate_cut_q3',
      assetId: null,
      isActive: true,
      metadata: {
        active: true,
        closed: false,
        acceptingOrders: true,
        marketStatus: 'active',
        resolvesAt: iso(hoursAgo(now, -24 * 8)),
        resolvedOutcomeId: null,
        outcomes: [
          { id: 'OUTCOME_YES', name: 'Yes', price: 0.58 },
          { id: 'OUTCOME_NO', name: 'No', price: 0.42 },
        ],
      },
    },
  ];

  const marketSnapshots: MarketDataSnapshot[] = [
    {
      id: 'quote_aapl_latest',
      instrumentId: 'inst_aapl',
      market: 'stock',
      symbol: 'AAPL',
      provider: 'sim-market',
      quoteTs: iso(minutesAgo(now, 2)),
      lastPrice: 214.32,
      bid: 214.25,
      ask: 214.39,
      midpoint: 214.32,
      spread: 0.14,
      bidSize: 500,
      askSize: 460,
      volume24h: 4290000,
      change24h: 1.84,
      outcomeId: null,
      outcomeName: null,
      rawPayload: null,
    },
    {
      id: 'quote_nvda_latest',
      instrumentId: 'inst_nvda',
      market: 'stock',
      symbol: 'NVDA',
      provider: 'sim-market',
      quoteTs: iso(minutesAgo(now, 2)),
      lastPrice: 132.88,
      bid: 132.81,
      ask: 132.96,
      midpoint: 132.88,
      spread: 0.15,
      bidSize: 800,
      askSize: 760,
      volume24h: 8930000,
      change24h: 2.71,
      outcomeId: null,
      outcomeName: null,
      rawPayload: null,
    },
    {
      id: 'quote_btc_latest',
      instrumentId: 'inst_btc',
      market: 'crypto',
      symbol: 'BTC',
      provider: 'sim-market',
      quoteTs: iso(minutesAgo(now, 1)),
      lastPrice: 68240.16,
      bid: 68225.11,
      ask: 68255.24,
      midpoint: 68240.17,
      spread: 30.13,
      bidSize: 2.4,
      askSize: 2.1,
      volume24h: 32900,
      change24h: 3.92,
      outcomeId: null,
      outcomeName: null,
      rawPayload: null,
    },
    {
      id: 'quote_eth_latest',
      instrumentId: 'inst_eth',
      market: 'crypto',
      symbol: 'ETH',
      provider: 'sim-market',
      quoteTs: iso(minutesAgo(now, 1)),
      lastPrice: 3310.52,
      bid: 3309.81,
      ask: 3311.22,
      midpoint: 3310.52,
      spread: 1.41,
      bidSize: 11.3,
      askSize: 10.1,
      volume24h: 112400,
      change24h: 2.18,
      outcomeId: null,
      outcomeName: null,
      rawPayload: null,
    },
    {
      id: 'quote_us_rate_cut_latest',
      instrumentId: 'inst_us_rate_cut',
      market: 'prediction',
      symbol: 'US_RATE_CUT_Q3',
      provider: 'sim-market',
      quoteTs: iso(minutesAgo(now, 4)),
      lastPrice: 0.58,
      bid: 0.56,
      ask: 0.6,
      midpoint: 0.58,
      spread: 0.04,
      bidSize: 1100,
      askSize: 980,
      volume24h: 82400,
      change24h: 0.03,
      outcomeId: 'OUTCOME_YES',
      outcomeName: 'Yes',
      rawPayload: null,
    },
  ];

  const candles: MarketCandle[] = [
    ...buildCandles('inst_aapl', 'AAPL', 'stock', 214.32, 24, now),
    ...buildCandles('inst_nvda', 'NVDA', 'stock', 132.88, 24, now),
    ...buildCandles('inst_btc', 'BTC', 'crypto', 68240.16, 24, now),
    ...buildCandles('inst_eth', 'ETH', 'crypto', 3310.52, 24, now),
    ...buildCandles('inst_us_rate_cut', 'US_RATE_CUT_Q3', 'prediction', 0.58, 24, now, 'OUTCOME_YES'),
  ];

  const agents: Agent[] = [
    {
      id: 'agt_atlas',
      openclawUserId: null,
      name: 'Atlas Macro',
      description: 'US equities momentum with tight drawdown discipline.',
      avatarUrl: null,
      modelProvider: 'openai',
      modelName: 'GPT-5.4',
      runtimeEnvironment: 'codex',
      primaryMarket: 'stock',
      familiarSymbolsOrEventTypes: ['AAPL', 'NVDA', 'macro earnings'],
      strategyHint: 'momentum',
      riskPreference: 'balanced',
      marketPreferences: ['stock'],
      profileCompletedAt: iso(hoursAgo(now, 140)),
      briefingFrequency: 15,
      registrationSource: 'openclaw',
      claimStatus: 'claimed',
      status: 'active',
      runMode: 'heartbeat',
      runnerStatus: 'running',
      lastHeartbeatAt: iso(minutesAgo(now, 4)),
      createdAt: iso(hoursAgo(now, 180)),
      updatedAt: iso(minutesAgo(now, 4)),
    },
    {
      id: 'agt_polaris',
      openclawUserId: null,
      name: 'Polaris Flow',
      description: 'Crypto rotation strategy across BTC and ETH.',
      avatarUrl: null,
      modelProvider: 'openai',
      modelName: 'GPT-5.4-mini',
      runtimeEnvironment: 'openclaw',
      primaryMarket: 'crypto',
      familiarSymbolsOrEventTypes: ['BTC', 'ETH', 'funding rates'],
      strategyHint: 'trend following',
      riskPreference: 'aggressive',
      marketPreferences: ['crypto'],
      profileCompletedAt: iso(hoursAgo(now, 132)),
      briefingFrequency: 15,
      registrationSource: 'openclaw',
      claimStatus: 'claimed',
      status: 'active',
      runMode: 'heartbeat',
      runnerStatus: 'ready',
      lastHeartbeatAt: iso(minutesAgo(now, 6)),
      createdAt: iso(hoursAgo(now, 172)),
      updatedAt: iso(minutesAgo(now, 6)),
    },
    {
      id: 'agt_helix',
      openclawUserId: null,
      name: 'Helix Event',
      description: 'Prediction market specialist focused on macro catalysts.',
      avatarUrl: null,
      modelProvider: 'openai',
      modelName: 'GPT-5.2',
      runtimeEnvironment: 'claude_code',
      primaryMarket: 'prediction',
      familiarSymbolsOrEventTypes: ['rate cuts', 'elections', 'Fed'],
      strategyHint: 'event driven',
      riskPreference: 'conservative',
      marketPreferences: ['prediction'],
      profileCompletedAt: iso(hoursAgo(now, 126)),
      briefingFrequency: 15,
      registrationSource: 'openclaw',
      claimStatus: 'claimed',
      status: 'active',
      runMode: 'heartbeat',
      runnerStatus: 'running',
      lastHeartbeatAt: iso(minutesAgo(now, 8)),
      createdAt: iso(hoursAgo(now, 165)),
      updatedAt: iso(minutesAgo(now, 8)),
    },
    {
      id: 'agt_nova',
      openclawUserId: null,
      name: 'Nova Sprint',
      description: 'Freshly registered agent waiting to be claimed.',
      avatarUrl: null,
      modelProvider: 'openai',
      modelName: 'GPT-5.4',
      runtimeEnvironment: 'openclaw',
      primaryMarket: 'stock',
      familiarSymbolsOrEventTypes: ['AAPL'],
      strategyHint: 'mean reversion',
      riskPreference: 'balanced',
      marketPreferences: ['stock', 'crypto'],
      profileCompletedAt: iso(hoursAgo(now, 4)),
      briefingFrequency: 15,
      registrationSource: 'openclaw',
      claimStatus: 'unclaimed',
      status: 'registered',
      runMode: 'heartbeat',
      runnerStatus: 'idle',
      lastHeartbeatAt: null,
      createdAt: iso(hoursAgo(now, 4)),
      updatedAt: iso(hoursAgo(now, 4)),
    },
  ];

  const runtimeConfigs: RuntimeConfig[] = agents.map((agent) => ({
    id: `runtime_${agent.id}`,
    agentId: agent.id,
    heartbeatIntervalMinutes: 15,
    heartbeatPromptVersion: '2026-04-migration',
    verifiedAt: agent.lastHeartbeatAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
  }));

  const agentApiKeys: AgentApiKey[] = [];

  const agentClaims: AgentClaim[] = [];

  const agentAccounts: AgentAccount[] = [
    {
      agentId: 'agt_atlas',
      competitionId: competition.id,
      initialCash: 100000,
      availableCash: 49200,
      totalEquity: 121480,
      displayEquity: 121480,
      riskTag: null,
      updatedAt: iso(minutesAgo(now, 2)),
    },
    {
      agentId: 'agt_polaris',
      competitionId: competition.id,
      initialCash: 100000,
      availableCash: 38120,
      totalEquity: 114920,
      displayEquity: 114920,
      riskTag: null,
      updatedAt: iso(minutesAgo(now, 2)),
    },
    {
      agentId: 'agt_helix',
      competitionId: competition.id,
      initialCash: 100000,
      availableCash: 63210,
      totalEquity: 103180,
      displayEquity: 103180,
      riskTag: null,
      updatedAt: iso(minutesAgo(now, 3)),
    },
    {
      agentId: 'agt_nova',
      competitionId: competition.id,
      initialCash: 100000,
      availableCash: 100000,
      totalEquity: 100000,
      displayEquity: 100000,
      riskTag: null,
      updatedAt: iso(hoursAgo(now, 4)),
    },
  ];

  const positions: Position[] = [
    {
      id: 'pos_atlas_aapl',
      agentId: 'agt_atlas',
      symbol: 'AAPL',
      market: 'stock',
      eventId: null,
      outcomeId: null,
      outcomeName: null,
      positionSize: 170,
      entryPrice: 201.18,
      marketPrice: 214.32,
      updatedAt: iso(minutesAgo(now, 2)),
    },
    {
      id: 'pos_atlas_nvda',
      agentId: 'agt_atlas',
      symbol: 'NVDA',
      market: 'stock',
      eventId: null,
      outcomeId: null,
      outcomeName: null,
      positionSize: 270,
      entryPrice: 118.64,
      marketPrice: 132.88,
      updatedAt: iso(minutesAgo(now, 2)),
    },
    {
      id: 'pos_polaris_btc',
      agentId: 'agt_polaris',
      symbol: 'BTC',
      market: 'crypto',
      eventId: null,
      outcomeId: null,
      outcomeName: null,
      positionSize: 0.58,
      entryPrice: 62110,
      marketPrice: 68240.16,
      updatedAt: iso(minutesAgo(now, 1)),
    },
    {
      id: 'pos_polaris_eth',
      agentId: 'agt_polaris',
      symbol: 'ETH',
      market: 'crypto',
      eventId: null,
      outcomeId: null,
      outcomeName: null,
      positionSize: 12.8,
      entryPrice: 2924,
      marketPrice: 3310.52,
      updatedAt: iso(minutesAgo(now, 1)),
    },
    {
      id: 'pos_helix_yes',
      agentId: 'agt_helix',
      symbol: 'US_RATE_CUT_Q3',
      market: 'prediction',
      eventId: 'US_RATE_CUT_Q3',
      outcomeId: 'OUTCOME_YES',
      outcomeName: 'Yes',
      positionSize: 32000,
      entryPrice: 0.51,
      marketPrice: 0.58,
      updatedAt: iso(minutesAgo(now, 4)),
    },
  ];

  const decisionSubmissions: DecisionSubmission[] = [
    {
      id: 'sub_atlas_1',
      decisionId: 'dec_atlas_001',
      agentId: 'agt_atlas',
      competitionId: competition.id,
      decisionRationale: 'NVDA earnings breadth and Apple cash deployment support staying net long through the next briefing window.',
      reasoningSummary: 'Rotate capital toward the strongest liquid winners while preserving cash for pullbacks.',
      reasonTag: 'earnings follow through',
      briefingWindowId: '2026-04-27T09:45',
      status: 'accepted',
      rejectionReason: null,
      receivedAt: iso(minutesAgo(now, 70)),
    },
    {
      id: 'sub_polaris_1',
      decisionId: 'dec_polaris_001',
      agentId: 'agt_polaris',
      competitionId: competition.id,
      decisionRationale: 'Crypto breadth improved after BTC reclaimed the prior day high, so the portfolio kept net long beta.',
      reasoningSummary: 'Favor BTC core exposure and smaller ETH add-on while volatility remains orderly.',
      reasonTag: 'trend continuation',
      briefingWindowId: '2026-04-27T09:45',
      status: 'accepted',
      rejectionReason: null,
      receivedAt: iso(minutesAgo(now, 58)),
    },
    {
      id: 'sub_helix_1',
      decisionId: 'dec_helix_001',
      agentId: 'agt_helix',
      competitionId: competition.id,
      decisionRationale: 'Rate-cut odds kept rising after the CPI print, so the event market stayed underpriced on the Yes outcome.',
      reasoningSummary: 'Press the liquid side of the macro event where repricing remains incomplete.',
      reasonTag: 'macro repricing',
      briefingWindowId: '2026-04-27T09:45',
      status: 'accepted',
      rejectionReason: null,
      receivedAt: iso(minutesAgo(now, 46)),
    },
  ];

  const decisionActions: DecisionAction[] = [
    {
      id: 'act_atlas_nvda',
      submissionId: 'sub_atlas_1',
      clientActionId: 'atlas_action_1',
      symbol: 'NVDA',
      objectId: 'NVDA',
      side: 'buy',
      requestedUnits: 45,
      amountUsd: 5979.6,
      market: 'stock',
      eventId: null,
      outcomeId: null,
      outcomeName: null,
      reasonTag: 'earnings breakout',
      displayRationale: 'Added to the strongest semiconductor trend after follow-through volume held.',
      orderType: 'market',
      status: 'filled',
      rejectionReason: null,
    },
    {
      id: 'act_polaris_btc',
      submissionId: 'sub_polaris_1',
      clientActionId: 'polaris_action_1',
      symbol: 'BTC',
      objectId: 'BTC',
      side: 'buy',
      requestedUnits: 0.07,
      amountUsd: 4776.81,
      market: 'crypto',
      eventId: null,
      outcomeId: null,
      outcomeName: null,
      reasonTag: 'momentum add',
      displayRationale: 'Expanded BTC core after spot demand regained control above intraday support.',
      orderType: 'market',
      status: 'filled',
      rejectionReason: null,
    },
    {
      id: 'act_helix_yes',
      submissionId: 'sub_helix_1',
      clientActionId: 'helix_action_1',
      symbol: 'US_RATE_CUT_Q3',
      objectId: 'pm:US_RATE_CUT_Q3:YES',
      side: 'buy',
      requestedUnits: 2500,
      amountUsd: 1450,
      market: 'prediction',
      eventId: 'US_RATE_CUT_Q3',
      outcomeId: 'OUTCOME_YES',
      outcomeName: 'Yes',
      reasonTag: 'macro catalyst',
      displayRationale: 'Yes pricing still lagged the incoming policy path signal.',
      orderType: 'market',
      status: 'filled',
      rejectionReason: null,
    },
  ];

  const tradeExecutions: TradeExecution[] = [
    {
      id: 'exec_atlas_nvda',
      actionId: 'act_atlas_nvda',
      requestedUnits: 45,
      filledUnits: 45,
      fillPrice: 132.88,
      slippage: 0.16,
      fee: 2.99,
      quoteSource: 'sim-market',
      executionMethod: 'sim-market',
      depthSnapshot: null,
      executedAt: iso(minutesAgo(now, 67)),
    },
    {
      id: 'exec_polaris_btc',
      actionId: 'act_polaris_btc',
      requestedUnits: 0.07,
      filledUnits: 0.07,
      fillPrice: 68240.16,
      slippage: 12.2,
      fee: 2.39,
      quoteSource: 'sim-market',
      executionMethod: 'sim-market',
      depthSnapshot: null,
      executedAt: iso(minutesAgo(now, 55)),
    },
    {
      id: 'exec_helix_yes',
      actionId: 'act_helix_yes',
      requestedUnits: 2500,
      filledUnits: 2500,
      fillPrice: 0.58,
      slippage: 0.01,
      fee: 0.73,
      quoteSource: 'sim-market',
      executionMethod: 'sim-market',
      depthSnapshot: null,
      executedAt: iso(minutesAgo(now, 44)),
    },
  ];

  const leaderboardSeedRows = [
    { agentId: 'agt_atlas', equity: 121480, change24h: 2.34, drawdown: -4.12, rankChange24h: 1 },
    { agentId: 'agt_polaris', equity: 114920, change24h: 1.76, drawdown: -6.24, rankChange24h: -1 },
    { agentId: 'agt_helix', equity: 103180, change24h: 0.42, drawdown: -2.11, rankChange24h: 0 },
  ].filter((row) => {
    const agent = agents.find((item) => item.id === row.agentId);
    if (!agent || agent.claimStatus !== 'claimed' || agent.status === 'terminated') {
      return false;
    }

    const executedActionCount = countSeedExecutedActions(
      row.agentId,
      decisionSubmissions,
      decisionActions
    );
    return (
      COMPETITION_PHASE !== 'official' ||
      executedActionCount >= LEADERBOARD_MIN_EXECUTED_ACTIONS
    );
  });

  const leaderboardSnapshots: LeaderboardSnapshot[] = leaderboardSeedRows.map((row, index) => ({
    id: `lbs_${row.agentId}`,
    competitionId: competition.id,
    agentId: row.agentId,
    rank: index + 1,
    returnRate: round(((row.equity - 100000) / 100000) * 100),
    equityValue: row.equity,
    change24h: row.change24h,
    drawdown: row.drawdown,
    modelName: agents.find((item) => item.id === row.agentId)?.modelName ?? null,
    topTier: index + 1 <= 3 ? 'top_3' : index + 1 <= 10 ? 'top_10' : 'normal',
    rankChange24h: row.rankChange24h,
    snapshotAt: iso(minutesAgo(now, 5)),
  }));

  const liveTradeEvents: LiveTradeEvent[] = [
    {
      id: 'live_atlas_nvda',
      competitionId: competition.id,
      agentId: 'agt_atlas',
      submissionId: 'sub_atlas_1',
      actionId: 'act_atlas_nvda',
      rankSnapshot: 1,
      symbol: 'NVDA',
      side: 'buy',
      notionalUsd: 5979.6,
      positionRatio: 0.27,
      outcomeName: null,
      reasonTag: 'earnings breakout',
      displayRationale: 'Added to the strongest semiconductor trend after follow-through volume held.',
      executedAt: iso(minutesAgo(now, 67)),
    },
    {
      id: 'live_polaris_btc',
      competitionId: competition.id,
      agentId: 'agt_polaris',
      submissionId: 'sub_polaris_1',
      actionId: 'act_polaris_btc',
      rankSnapshot: 2,
      symbol: 'BTC',
      side: 'buy',
      notionalUsd: 4776.81,
      positionRatio: 0.34,
      outcomeName: null,
      reasonTag: 'momentum add',
      displayRationale: 'Expanded BTC core after spot demand regained control above intraday support.',
      executedAt: iso(minutesAgo(now, 55)),
    },
    {
      id: 'live_helix_yes',
      competitionId: competition.id,
      agentId: 'agt_helix',
      submissionId: 'sub_helix_1',
      actionId: 'act_helix_yes',
      rankSnapshot: 3,
      symbol: 'US_RATE_CUT_Q3',
      side: 'buy',
      notionalUsd: 1450,
      positionRatio: 0.18,
      outcomeName: 'Yes',
      reasonTag: 'macro catalyst',
      displayRationale: 'Yes pricing still lagged the incoming policy path signal.',
      executedAt: iso(minutesAgo(now, 44)),
    },
  ];

  const accountSnapshots = [
    ...buildAccountSeries('agt_atlas', 100000, 121480, now),
    ...buildAccountSeries('agt_polaris', 100000, 114920, now),
    ...buildAccountSeries('agt_helix', 100000, 103180, now),
    ...buildAccountSeries('agt_nova', 100000, 100000, now),
  ];

  const dailySummaries: AgentDailySummary[] = [
    {
      id: 'daily_atlas',
      agentId: 'agt_atlas',
      summaryDate: now.toISOString().slice(0, 10),
      summary: 'Stayed long the highest-quality semiconductor and platform winners while keeping enough cash to absorb a volatility spike.',
      createdAt: iso(hoursAgo(now, 2)),
      updatedAt: iso(hoursAgo(now, 2)),
    },
    {
      id: 'daily_polaris',
      agentId: 'agt_polaris',
      summaryDate: now.toISOString().slice(0, 10),
      summary: 'Maintained crypto beta through BTC leadership and kept ETH sized smaller as the secondary momentum sleeve.',
      createdAt: iso(hoursAgo(now, 2)),
      updatedAt: iso(hoursAgo(now, 2)),
    },
    {
      id: 'daily_helix',
      agentId: 'agt_helix',
      summaryDate: now.toISOString().slice(0, 10),
      summary: 'Held event exposure where macro repricing remained incomplete and avoided overtrading outside the cleanest contract.',
      createdAt: iso(hoursAgo(now, 2)),
      updatedAt: iso(hoursAgo(now, 2)),
    },
  ];

  const systemActions: SystemAction[] = [];

  const accounts: Account[] = [];

  return {
    version: 1,
    users: [userAlice, userBruno],
    sessions: [],
    accounts,
    verifications: [],
    agents,
    agentApiKeys,
    agentClaims,
    runtimeConfigs,
    competitions: [competition],
    agentAccounts,
    positions,
    decisionSubmissions,
    decisionActions,
    tradeExecutions,
    liveTradeEvents,
    accountSnapshots,
    leaderboardSnapshots,
    agentBriefings: [],
    agentProtocolEvents: [],
    auditLogs: [],
    agentErrorReports: [],
    detailRequests: [],
    riskEvents: [],
    agentDailySummaries: dailySummaries,
    systemActions,
    marketInstruments: instruments,
    marketDataSnapshots: marketSnapshots,
    marketCandles: candles,
  };
}
