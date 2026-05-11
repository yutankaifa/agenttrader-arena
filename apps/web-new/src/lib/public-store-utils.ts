import type {
  AgentAccount,
  AgentTraderStore,
  Competition,
  MarketDataSnapshot,
  MarketType,
  Position,
} from '@/db/schema';
import { readStore } from '@/db/store';
import { normalizeTimestampToIsoString } from '@/lib/timestamp';
import { INITIAL_CAPITAL } from '@/lib/trading-rules';

export function getPublicStore() {
  return readStore();
}

export function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

export function toIsoString(value: string | Date | null | undefined) {
  return normalizeTimestampToIsoString(value);
}

export function getClaimedAgents(store: AgentTraderStore) {
  return store.agents.filter((agent) => agent.claimStatus === 'claimed');
}

export function getClaimedAgent(store: AgentTraderStore, agentId: string) {
  return (
    store.agents.find(
      (agent) => agent.id === agentId && agent.claimStatus === 'claimed'
    ) ?? null
  );
}

export function getAgentAccount(store: AgentTraderStore, agentId: string) {
  return store.agentAccounts.find((account) => account.agentId === agentId) ?? null;
}

export function getLatestCompetition(store: AgentTraderStore): Competition | null {
  return (
    store.competitions
      .slice()
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )[0] ?? null
  );
}

export function getLatestLeaderboardSnapshots(store: AgentTraderStore) {
  const claimedIds = new Set(getClaimedAgents(store).map((agent) => agent.id));
  const snapshots = store.leaderboardSnapshots.filter((snapshot) =>
    claimedIds.has(snapshot.agentId)
  );
  if (!snapshots.length) {
    return [];
  }

  const latestSnapshotAt = snapshots
    .map((snapshot) => new Date(snapshot.snapshotAt).getTime())
    .reduce((latest, next) => Math.max(latest, next), 0);

  return snapshots
    .filter(
      (snapshot) =>
        new Date(snapshot.snapshotAt).getTime() === latestSnapshotAt
    )
    .sort((left, right) => left.rank - right.rank);
}

export function getLatestMarketSnapshot(
  store: AgentTraderStore,
  input: {
    symbol: string;
    market: MarketType;
    outcomeId?: string | null;
  }
): MarketDataSnapshot | null {
  const exactMatches = store.marketDataSnapshots.filter(
    (snapshot) =>
      snapshot.symbol === input.symbol &&
      snapshot.market === input.market &&
      (snapshot.outcomeId ?? null) === (input.outcomeId ?? null)
  );

  const fallbackMatches =
    input.outcomeId == null
      ? store.marketDataSnapshots.filter(
          (snapshot) =>
            snapshot.symbol === input.symbol &&
            snapshot.market === input.market &&
            snapshot.outcomeId == null
        )
      : [];

  const candidates = exactMatches.length ? exactMatches : fallbackMatches;
  if (!candidates.length) {
    return null;
  }

  return candidates
    .slice()
    .sort(
      (left, right) =>
        new Date(right.quoteTs).getTime() - new Date(left.quoteTs).getTime()
    )[0];
}

export function buildPublicPositionView(
  store: AgentTraderStore,
  position: Position
) {
  const latestQuote = getLatestMarketSnapshot(store, {
    symbol: position.symbol,
    market: position.market,
    outcomeId: position.outcomeId,
  });
  const marketPrice =
    latestQuote?.lastPrice ?? position.marketPrice ?? position.entryPrice;
  const marketValue = roundToCents(marketPrice * position.positionSize);
  const unrealizedPnl = roundToCents(
    (marketPrice - position.entryPrice) * position.positionSize
  );

  return {
    id: position.id,
    symbol: position.symbol,
    market: position.market,
    eventId: position.eventId,
    outcomeId: position.outcomeId,
    outcomeName: position.outcomeName,
    positionSize: position.positionSize,
    avgPrice: position.entryPrice,
    marketPrice,
    marketValue,
    unrealizedPnl,
    updatedAt: position.updatedAt,
  };
}

export function getLiveEquity(
  store: AgentTraderStore,
  account: AgentAccount | null,
  agentId: string
) {
  const availableCash =
    account?.availableCash ?? account?.initialCash ?? INITIAL_CAPITAL;
  const grossMarketValue = store.positions
    .filter((position) => position.agentId === agentId)
    .map((position) => buildPublicPositionView(store, position))
    .reduce((sum, position) => sum + (position.marketValue ?? 0), 0);

  return {
    availableCash,
    grossMarketValue: roundToCents(grossMarketValue),
    totalEquity: roundToCents(availableCash + grossMarketValue),
  };
}

export function formatDateInTimeZone(
  value: string | Date,
  timeZone: string
) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof value === 'string' ? new Date(value) : value);
}
