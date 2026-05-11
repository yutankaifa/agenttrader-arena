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

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Verification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  openclawUserId: string | null;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  xUrl?: string | null;
  modelProvider: string | null;
  modelName: string | null;
  runtimeEnvironment: string | null;
  primaryMarket: MarketType | null;
  familiarSymbolsOrEventTypes: string[];
  strategyHint: string | null;
  riskPreference: 'conservative' | 'balanced' | 'aggressive' | null;
  marketPreferences: MarketType[];
  profileCompletedAt: string | null;
  briefingFrequency: number;
  registrationSource: string;
  claimStatus: AgentClaimStatus;
  status: AgentStatus;
  runMode: 'heartbeat';
  runnerStatus: RunnerStatus;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentApiKey {
  id: string;
  agentId: string;
  apiKeyHash: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

export interface AgentClaim {
  id: string;
  agentId: string;
  claimToken: string;
  claimUrl: string;
  claimedBy: string | null;
  claimedAt: string | null;
  status: ClaimStatus;
}

export interface RuntimeConfig {
  id: string;
  agentId: string;
  heartbeatIntervalMinutes: number;
  heartbeatPromptVersion: string | null;
  verifiedAt: string | null;
  lastHeartbeatAt: string | null;
  lastHeartbeatSuccessAt: string | null;
  lastHeartbeatFailureAt: string | null;
  lastHeartbeatFailureCode: string | null;
  lastHeartbeatFailureMessage: string | null;
  lastHeartbeatFailureStatus: number | null;
  consecutiveHeartbeatFailures: number;
}

export interface Competition {
  id: string;
  name: string;
  description: string | null;
  status: 'upcoming' | 'active' | 'ended';
  marketTypes: MarketType[];
  ruleVersion: string;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
}

export interface AgentAccount {
  agentId: string;
  competitionId: string;
  initialCash: number;
  availableCash: number;
  totalEquity: number;
  displayEquity: number;
  riskTag: RiskTag;
  updatedAt: string;
}

export interface Position {
  id: string;
  agentId: string;
  symbol: string;
  market: MarketType;
  eventId: string | null;
  outcomeId: string | null;
  outcomeName: string | null;
  positionSize: number;
  entryPrice: number;
  marketPrice: number | null;
  updatedAt: string;
}

export interface DecisionSubmission {
  id: string;
  decisionId: string;
  agentId: string;
  competitionId: string;
  decisionRationale: string;
  reasoningSummary: string;
  reasonTag: string;
  briefingWindowId: string | null;
  status: DecisionStatus;
  rejectionReason: string | null;
  receivedAt: string;
}

export interface DecisionAction {
  id: string;
  submissionId: string;
  clientActionId: string;
  symbol: string;
  objectId: string;
  side: 'buy' | 'sell';
  requestedUnits: number;
  amountUsd: number;
  market: MarketType;
  eventId: string | null;
  outcomeId: string | null;
  outcomeName: string | null;
  reasonTag: string;
  displayRationale: string;
  orderType: 'market';
  status: ActionStatus;
  rejectionReason: string | null;
}

export interface TradeExecution {
  id: string;
  actionId: string;
  requestedUnits: number;
  filledUnits: number;
  fillPrice: number;
  slippage: number;
  fee: number;
  quoteSource: string | null;
  executionMethod: string | null;
  depthSnapshot: string | null;
  executedAt: string;
}

export interface LiveTradeEvent {
  id: string;
  competitionId: string;
  agentId: string;
  submissionId: string;
  actionId: string;
  rankSnapshot: number | null;
  symbol: string;
  side: 'buy' | 'sell';
  notionalUsd: number;
  positionRatio: number | null;
  outcomeName: string | null;
  reasonTag: string | null;
  displayRationale: string | null;
  executedAt: string;
}

export interface AccountSnapshot {
  id: string;
  agentId: string;
  ts: string;
  cash: number;
  equity: number;
  drawdown: number;
  returnRate: number;
}

export interface LeaderboardSnapshot {
  id: string;
  competitionId: string;
  agentId: string;
  rank: number;
  returnRate: number;
  equityValue: number;
  change24h: number;
  drawdown: number;
  modelName: string | null;
  topTier: 'top_3' | 'top_10' | 'normal';
  rankChange24h: number;
  snapshotAt: string;
}

export interface AgentBriefingRecord {
  id: string;
  agentId: string;
  briefingWindowId: string | null;
  payload: string;
  createdAt: string;
}

export interface AgentProtocolEvent {
  id: string;
  agentId: string;
  endpointKey: 'heartbeat_ping' | 'briefing' | 'detail_request' | 'decision';
  httpMethod: 'GET' | 'POST';
  requestId: string | null;
  decisionId: string | null;
  briefingWindowId: string | null;
  statusCode: number;
  requestSuccess: boolean;
  requestPayload: string | null;
  responsePayload: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  agentId: string | null;
  eventType: string;
  payload: string | null;
  createdAt: string;
}

export interface AgentErrorReport {
  id: string;
  agentId: string;
  reportType: 'api_error' | 'runtime_exception' | 'unexpected_result';
  sourceEndpoint: string | null;
  httpMethod: string | null;
  requestId: string | null;
  decisionId: string | null;
  windowId: string | null;
  errorCode: string | null;
  statusCode: number | null;
  summary: string;
  requestPayload: string | null;
  responsePayload: string | null;
  runtimeContext: string | null;
  createdAt: string;
}

export interface DetailRequest {
  id: string;
  agentId: string;
  competitionId: string;
  requestId: string;
  decisionWindowStart: string | null;
  briefingWindowId: string | null;
  requestReason: string;
  objectsRequested: string[];
  symbolsRequested: string[];
  responseSummary: string;
  requestedAt: string;
}

export interface RiskEvent {
  id: string;
  agentId: string;
  competitionId: string;
  eventType: string;
  triggerValue: number | null;
  thresholdValue: number | null;
  actionTaken: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AgentDailySummary {
  id: string;
  agentId: string;
  summaryDate: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemAction {
  id: string;
  agentId: string | null;
  positionId: string | null;
  actionSource: string;
  reason: string | null;
  payload: string | null;
  createdAt: string;
}

export interface PredictionOutcomeMeta {
  id: string;
  name: string;
  price: number;
}

export interface MarketInstrument {
  id: string;
  market: MarketType;
  symbol: string;
  displayName: string;
  provider: string;
  providerSymbol: string | null;
  providerMarketId: string | null;
  assetId: string | null;
  isActive: boolean;
  metadata: {
    active?: boolean;
    closed?: boolean;
    acceptingOrders?: boolean;
    marketStatus?: string;
    resolvesAt?: string;
    resolvedOutcomeId?: string | null;
    outcomes?: PredictionOutcomeMeta[];
  } | null;
}

export interface MarketDataSnapshot {
  id: string;
  instrumentId: string;
  market: MarketType;
  symbol: string;
  provider: string;
  quoteTs: string;
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
  outcomeId: string | null;
  outcomeName: string | null;
  rawPayload: string | null;
}

export interface MarketCandle {
  id: string;
  instrumentId: string;
  market: MarketType;
  symbol: string;
  interval: string;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  tradeCount: number | null;
  vwap: number | null;
  outcomeId: string | null;
}

export interface AgentTraderStore {
  version: number;
  users: User[];
  sessions: Session[];
  accounts: Account[];
  verifications: Verification[];
  agents: Agent[];
  agentApiKeys: AgentApiKey[];
  agentClaims: AgentClaim[];
  runtimeConfigs: RuntimeConfig[];
  competitions: Competition[];
  agentAccounts: AgentAccount[];
  positions: Position[];
  decisionSubmissions: DecisionSubmission[];
  decisionActions: DecisionAction[];
  tradeExecutions: TradeExecution[];
  liveTradeEvents: LiveTradeEvent[];
  accountSnapshots: AccountSnapshot[];
  leaderboardSnapshots: LeaderboardSnapshot[];
  agentBriefings: AgentBriefingRecord[];
  agentProtocolEvents: AgentProtocolEvent[];
  auditLogs: AuditLog[];
  agentErrorReports: AgentErrorReport[];
  detailRequests: DetailRequest[];
  riskEvents: RiskEvent[];
  agentDailySummaries: AgentDailySummary[];
  systemActions: SystemAction[];
  marketInstruments: MarketInstrument[];
  marketDataSnapshots: MarketDataSnapshot[];
  marketCandles: MarketCandle[];
}
