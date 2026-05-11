import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { updateStore } from '@/db/store';
import { updateAgentAccountState } from '@/lib/agent-account-state';
import { writeRiskEvent } from '@/lib/agent-events';
import { roundUsd } from '@/lib/utils';

type PredictionInstrumentMetadata = {
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  marketStatus?: string;
  resolvesAt?: string;
  resolvedOutcomeId?: string | null;
  outcomes?: Array<{ id?: string | null; name?: string; price?: number | null }>;
};

function normalizePredictionInstrumentMetadata(
  raw: unknown
): PredictionInstrumentMetadata | null {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object'
        ? (parsed as PredictionInstrumentMetadata)
        : null;
    } catch {
      return null;
    }
  }

  return typeof raw === 'object' ? (raw as PredictionInstrumentMetadata) : null;
}

async function settleResolvedPredictionMarketsDatabase() {
  const sql = getSqlClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const instruments = await sql<
    {
      id: string;
      symbol: string;
      metadata: unknown;
    }[]
  >`
    select
      id,
      symbol,
      metadata
    from market_instruments
    where market = 'prediction'
  `;

  const resolvableInstruments = instruments
    .map((instrument) => {
      const metadata = normalizePredictionInstrumentMetadata(instrument.metadata);
      const resolvesAt = metadata?.resolvesAt ? Date.parse(metadata.resolvesAt) : Number.NaN;
      const resolvedOutcomeId = metadata?.resolvedOutcomeId ?? null;
      if (!Number.isFinite(resolvesAt) || resolvesAt > now || !resolvedOutcomeId) {
        return null;
      }

      return {
        id: instrument.id,
        symbol: instrument.symbol,
        metadata: metadata ?? {},
        resolvedOutcomeId,
      };
    })
    .filter(
      (
        item
      ): item is {
        id: string;
        symbol: string;
        metadata: PredictionInstrumentMetadata;
        resolvedOutcomeId: string;
      } => Boolean(item)
    );

  if (!resolvableInstruments.length) {
    return {
      settled_positions: 0,
      settled_markets: 0,
      settled_at: nowIso,
    };
  }

  const instrumentSymbols = resolvableInstruments.map((item) => item.symbol);
  const positions = await sql<
    {
      id: string;
      agent_id: string;
      symbol: string;
      outcome_id: string | null;
      position_size: number | null;
    }[]
  >`
    select
      id,
      agent_id,
      symbol,
      outcome_id,
      position_size
    from positions
    where market = 'prediction'
      and symbol = any(${instrumentSymbols})
  `;

  type PredictionPositionRow = (typeof positions)[number];
  const positionsBySymbol = new Map<string, PredictionPositionRow[]>();
  for (const position of positions) {
    const group = positionsBySymbol.get(position.symbol) ?? [];
    group.push(position);
    positionsBySymbol.set(position.symbol, group);
  }

  const payoutsByAgent = new Map<string, number>();
  const settledPositionIds: string[] = [];

  for (const instrument of resolvableInstruments) {
    const relatedPositions = positionsBySymbol.get(instrument.symbol) ?? [];
    for (const position of relatedPositions) {
      const payoutPerUnit =
        position.outcome_id != null && position.outcome_id === instrument.resolvedOutcomeId
          ? 1
          : 0;
      const payout = roundUsd((position.position_size ?? 0) * payoutPerUnit);
      payoutsByAgent.set(
        position.agent_id,
        roundUsd((payoutsByAgent.get(position.agent_id) ?? 0) + payout)
      );
      settledPositionIds.push(position.id);
    }
  }

  const affectedAgentIds = [...payoutsByAgent.keys()];
  const accountRows = affectedAgentIds.length
    ? await sql<
        {
          agent_id: string;
          competition_id: string | null;
          available_cash: number | null;
        }[]
      >`
        select
          agent_id,
          competition_id,
          available_cash
        from agent_accounts
        where agent_id = any(${affectedAgentIds})
      `
    : [];

  const accountContext = new Map(
    accountRows.map((row) => [
      row.agent_id,
      {
        competitionId: row.competition_id,
        availableCash: row.available_cash ?? 0,
      },
    ])
  );

  await sql.begin(async (tx) => {
    if (settledPositionIds.length) {
      await tx`
        delete from positions
        where id = any(${settledPositionIds})
      `;
    }

    for (const [agentId, payout] of payoutsByAgent.entries()) {
      await tx`
        update agent_accounts
        set
          available_cash = available_cash + ${payout},
          updated_at = ${nowIso}
        where agent_id = ${agentId}
      `;
    }

    for (const instrument of resolvableInstruments) {
      const nextMetadata = {
        ...instrument.metadata,
        active: false,
        closed: true,
        acceptingOrders: false,
        marketStatus: 'resolved',
      };
      await tx`
        update market_instruments
        set
          is_active = false,
          metadata = ${JSON.stringify(nextMetadata)}
        where id = ${instrument.id}
      `;
    }
  });

  for (const [agentId, payout] of payoutsByAgent.entries()) {
    const currentAccount = accountContext.get(agentId);
    if (!currentAccount) {
      continue;
    }

    const nextAvailableCash = roundUsd(currentAccount.availableCash + payout);
    const accountState = await updateAgentAccountState({
      agentId,
      availableCash: nextAvailableCash,
    });
    await writeRiskEvent({
      agentId,
      competitionId: currentAccount.competitionId,
      previousRiskTag: accountState.previousRiskTag,
      riskTag: accountState.riskTag,
      cash: nextAvailableCash,
      equity: accountState.totalEquity,
    });
  }

  return {
    settled_positions: settledPositionIds.length,
    settled_markets: resolvableInstruments.length,
    settled_at: nowIso,
  };
}

async function settleResolvedPredictionMarketsStore() {
  let settledPositions = 0;
  let settledMarkets = 0;

  await updateStore((store) => {
    const now = Date.now();
    for (const instrument of store.marketInstruments) {
      if (instrument.market !== 'prediction') continue;
      const resolvesAt = instrument.metadata?.resolvesAt
        ? new Date(instrument.metadata.resolvesAt).getTime()
        : null;
      const resolvedOutcomeId = instrument.metadata?.resolvedOutcomeId ?? null;

      if (!resolvesAt || resolvesAt > now || !resolvedOutcomeId) {
        continue;
      }

      const relatedPositions = store.positions.filter(
        (item) =>
          item.market === 'prediction' && item.symbol.toUpperCase() === instrument.symbol.toUpperCase()
      );

      for (const position of relatedPositions) {
        const account = store.agentAccounts.find((item) => item.agentId === position.agentId);
        if (!account) continue;

        const payoutPerUnit = position.outcomeId === resolvedOutcomeId ? 1 : 0;
        const payout = roundUsd(position.positionSize * payoutPerUnit);
        account.availableCash = roundUsd(account.availableCash + payout);
        settledPositions += 1;
      }

      store.positions = store.positions.filter(
        (item) =>
          !(
            item.market === 'prediction' &&
            item.symbol.toUpperCase() === instrument.symbol.toUpperCase()
          )
      );
      instrument.metadata = {
        ...instrument.metadata,
        active: false,
        closed: true,
        acceptingOrders: false,
        marketStatus: 'resolved',
      };
      settledMarkets += 1;
    }
  });

  return {
    settled_positions: settledPositions,
    settled_markets: settledMarkets,
    settled_at: new Date().toISOString(),
  };
}

export async function settleResolvedPredictionMarkets() {
  if (isDatabaseConfigured()) {
    return settleResolvedPredictionMarketsDatabase();
  }

  return settleResolvedPredictionMarketsStore();
}
