export type MarketType = 'stock' | 'crypto' | 'prediction';
export type AgentClaimStatus = 'unclaimed' | 'claimed';
export type AgentStatus = 'registered' | 'active' | 'paused' | 'terminated';
export type RunnerStatus = 'idle' | 'ready' | 'running' | 'error';
export type RiskTag = null | 'high_risk' | 'close_only' | 'terminated';
export type DecisionStatus = 'pending' | 'accepted' | 'rejected';
export type ActionStatus =
  | 'pending'
  | 'filled'
  | 'partial'
  | 'cancelled'
  | 'rejected';
export type ClaimStatus = 'pending' | 'claimed' | 'expired';

export declare const MARKET_TYPES: readonly MarketType[];
export declare function isMarketType(value: unknown): value is MarketType;

export declare const AGENTTRADER_PROTOCOL_VERSION = 'agentrader.v1';

export declare const AGENT_SCHEMA_VERSION: {
  readonly briefingResponse: '2026-04-19.1';
  readonly detailResponse: '2026-04-19.1';
  readonly decisionExecutionResult: '2026-04-27.1';
};

export declare const AGENT_REQUEST_TYPE: {
  readonly decision: 'decision';
  readonly detailRequest: 'detail_request';
  readonly dailySummaryUpdate: 'daily_summary_update';
  readonly errorReport: 'error_report';
};

export declare const AGENT_RESPONSE_TYPE: {
  readonly detailResponse: 'detail_response';
  readonly decisionExecutionResult: 'decision_execution_result';
  readonly dailySummaryUpdateResult: 'daily_summary_update_result';
};

export declare const AGENT_AUDIT_EVENT_TYPE: {
  readonly register: 'register';
};

export type AgentProtocolMetadata = {
  schema_version: string;
  protocol_version: typeof AGENTTRADER_PROTOCOL_VERSION;
  generated_at: string;
};

export declare function buildProtocolMetadata(
  schemaVersion: string,
  now?: Date
): AgentProtocolMetadata;

export declare function buildTypedProtocolPayload<
  TType extends string,
  TBody extends object,
>(input: {
  type: TType;
  schemaVersion: string;
  now?: Date;
  body: TBody;
}): { type: TType } & AgentProtocolMetadata & TBody;

export declare function buildExpectedTypeMessage(expectedType: string): string;

export type AgentApiErrorBody = {
  code: string;
  message: string;
  recoverable: boolean;
  retry_allowed: boolean;
  retry_after_seconds?: number;
  details?: Record<string, unknown>;
};

export type AgentApiSuccess<TData, TMeta extends Record<string, unknown> = Record<string, unknown>> = {
  success: true;
  data: TData;
  meta?: TMeta;
};

export type AgentApiFailure = {
  success: false;
  error?: AgentApiErrorBody;
};

export type AgentApiResponse<TData, TMeta extends Record<string, unknown> = Record<string, unknown>> =
  | AgentApiSuccess<TData, TMeta>
  | AgentApiFailure;

export type PublicAgentSummaryResponse = AgentApiResponse<PublicAgentSummary>;
export type PublicPositionsResponse = AgentApiResponse<PublicPosition[]>;
export type PublicTradesResponse = AgentApiResponse<PublicTrade[], TradesMeta>;
export type PublicEquityResponse = AgentApiResponse<PublicEquityData>;
export type PublicSnapshotAuditResponse = AgentApiResponse<PublicSnapshotAudit>;
export type PublicStatsResponse = AgentApiResponse<PublicStats>;
export type PublicLeaderboardResponse = AgentApiResponse<PublicLeaderboardData>;
export type PublicLiveTradesResponse = AgentApiResponse<PublicLiveTradesData>;
export type PublicHomeOverviewResponse = AgentApiResponse<PublicHomeOverview>;
export type OwnedAgentSummaryResponse = AgentApiResponse<OwnedAgentSummary>;
export type OwnedPositionsResponse = AgentApiResponse<OwnedPosition[]>;
export type OwnedTradesResponse = AgentApiResponse<OwnedTrade[], TradesMeta>;

export type PublicTopTier = 'top_3' | 'top_10' | 'normal';

export type PublicStats = {
  agents: number;
  capitalTracked: number;
  winRate: number;
  trackedAccounts?: number;
};

export type PublicLeaderboardEntry = {
  rank: number;
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  returnRate: number;
  equityValue: number;
  change24h: number | null;
  drawdown: number | null;
  modelName: string | null;
  topTier: PublicTopTier;
  rankChange24h: number;
  riskTag?: RiskTag;
  closeOnly?: boolean;
  snapshotAt?: string | null;
};

export type PublicLeaderboardData = {
  items: PublicLeaderboardEntry[];
  snapshotAt: string | null;
  competitionId?: string | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PublicLiveTrade = {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  symbol: string;
  market?: string | null;
  side: 'buy' | 'sell';
  notionalUsd: number;
  fillPrice?: number | null;
  executionPath?: string | null;
  positionRatio?: number | null;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  riskTag?: RiskTag;
  closeOnly?: boolean;
  rankSnapshot?: number | null;
  topTier: PublicTopTier;
  executedAt: string | null;
};

export type PublicLiveTradesData = {
  items: PublicLiveTrade[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

export type HomeCallInsight = {
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  symbol: string;
  market: string;
  side: string;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  filledUnits: number;
  fillPrice: number;
  markPrice: number;
  callPnlUsd: number;
  currentRank?: number | null;
  executedAt: string | null;
};

export type PublicLargestPosition = {
  agentId: string;
  agentName: string;
  symbol: string;
  market: string;
  outcomeName?: string | null;
  positionSize: number | null;
  entryPrice: number | null;
  marketPrice: number | null;
  marketValue: number;
};

export type PublicHomeOverview = {
  tradesToday: number;
  bestCall: HomeCallInsight | null;
  worstCall: HomeCallInsight | null;
  biggestTrade: PublicLiveTrade | null;
  largestPosition: PublicLargestPosition | null;
};

export type OwnedAgent = {
  id: string;
  name: string;
  status: string;
  runnerStatus: string;
  xUrl?: string | null;
  initialCash: number;
  availableCash: number;
  totalEquity: number;
  displayEquity: number;
  returnRate: number;
  displayReturnRate: number;
  riskTag?: RiskTag;
  closeOnly?: boolean;
  lastHeartbeatAt: string | null;
  lastHeartbeatSuccessAt: string | null;
  lastHeartbeatFailureAt: string | null;
  lastHeartbeatFailureCode: string | null;
  lastHeartbeatFailureMessage: string | null;
  lastHeartbeatFailureStatus: number | null;
  consecutiveHeartbeatFailures: number;
};

export type PublicAgentSummary = {
  agent: {
    id: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    xUrl?: string | null;
    modelName: string | null;
    primaryMarket: string | null;
    marketPreferences: string[] | null;
    status: string;
    lastHeartbeatAt: string | null;
    createdAt: string | null;
  };
  performance: {
    rank: number | null;
    topTier: string | null;
    totalEquity: number;
    displayEquity: number;
    returnRate: number;
    displayReturnRate: number;
    drawdown: number | null;
    snapshotAt: string | null;
    riskTag?: RiskTag;
    riskMode?: string | null;
    closeOnly?: boolean;
  };
  positionsOverview: {
    openPositions: number;
    grossMarketValue: number;
    unrealizedPnl: number;
  };
  dailySummary?: {
    period: string;
    timeZone: string;
    summary: string;
  };
};

export type PublicPosition = {
  id: string;
  symbol: string;
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  positionSize: number;
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  updatedAt?: string | null;
};

export type PublicTrade = {
  executionId: string;
  symbol: string;
  side: 'buy' | 'sell';
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  filledUnits: number;
  fillPrice: number;
  executionPath?: string | null;
  fee: number;
  executedAt: string | null;
};

export type PublicEquityData = {
  series: Array<{
    ts: string | null;
    equity: number;
    drawdown: number;
    returnRate: number;
  }>;
  stats: {
    currentEquity: number;
    maxDrawdown: number;
    totalReturn: number;
    dataPoints: number;
  };
};

export type PublicSnapshotAudit = {
  snapshot: {
    id: string;
    ts: string | null;
    cash: number;
    equity: number;
    drawdown: number;
    returnRate: number;
  } | null;
  positions: Array<{
    id: string;
    positionId?: string | null;
    symbol: string;
    market: string;
    eventId?: string | null;
    outcomeId?: string | null;
    outcomeName?: string | null;
    positionSize: number;
    entryPrice: number | null;
    marketPrice: number | null;
    pricingSource: string | null;
    marketValue: number | null;
    unrealizedPnl: number | null;
  }>;
  coverage: 'position_prices' | 'aggregate_only' | 'none';
};

export type OwnedAgentSummary = {
  agent: {
    id: string;
    name: string;
    description: string | null;
    xUrl?: string | null;
    modelProvider: string | null;
    modelName: string | null;
    runtimeEnvironment: string | null;
    strategyHint: string | null;
    status: string;
    runnerStatus: string;
    claimStatus: string;
    lastHeartbeatAt: string | null;
  };
  account: {
    initialCash: number;
    availableCash: number;
    totalEquity: number;
    displayEquity: number;
    returnRate: number;
    displayReturnRate: number;
    riskTag: RiskTag;
  };
  runtimeConfig: {
    heartbeatIntervalMinutes: number;
    lastHeartbeatAt: string | null;
    lastHeartbeatSuccessAt: string | null;
    lastHeartbeatFailureAt: string | null;
    lastHeartbeatFailureCode: string | null;
    lastHeartbeatFailureMessage: string | null;
    lastHeartbeatFailureStatus: number | null;
    consecutiveHeartbeatFailures: number;
  };
};

export type OwnedPosition = {
  id: string;
  symbol: string;
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  positionSize: number;
  entryPrice: number | null;
  marketPrice: number | null;
  unrealizedPnl: number | null;
};

export type OwnedTrade = {
  executionId: string;
  actionId: string;
  symbol: string;
  objectId?: string | null;
  side: 'buy' | 'sell';
  market: string;
  requestedUnits: number;
  filledUnits: number;
  fillPrice: number;
  executionPath?: string | null;
  slippage: number;
  fee: number;
  executedAt: string | null;
};

export type TradesMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type MarketQuote = {
  market: MarketType;
  provider: string;
  symbol: string;
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
  depthSnapshot?: string | null;
  volume24h: number | null;
  change24h: number | null;
  timestamp: string;
  outcomeId?: string | null;
  outcomeName?: string | null;
};

export type QuoteLookup =
  | string
  | {
      symbol: string;
      market?: MarketType | null;
      outcomeId?: string | null;
    };

export declare const QUOTE_KEY_PREFIX = 'market:quote:';
export declare const QUOTE_SYMBOL_LIST_PREFIX = 'market:quotes:';
export declare const RECENT_SYMBOL_LIST_PREFIX = 'market:recent-symbols:';

export declare const WORKER_QUOTE_TTL_SECONDS = 180;
export declare const WORKER_SYMBOL_LIST_TTL_SECONDS = 120;

export declare function normalizeQuoteKeyPart(value: string): string;
export declare function quoteKey(input: QuoteLookup): string;
export declare function quoteSymbolListKey(marketType: MarketType): string;
export declare function recentQuoteSymbolListKey(marketType: MarketType): string;
