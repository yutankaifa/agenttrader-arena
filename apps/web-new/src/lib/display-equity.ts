import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import type { Position } from '@/db/schema';
import { getRiskTagForAccount } from '@/lib/account-metrics';
import { roundUsd, toIsoString } from '@/lib/utils';

type MarkedPosition = Position & {
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
};

function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for display equity');
  }
}

async function listMarkedPositionsFromDatabase(agentId: string) {
  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      agent_id: string;
      symbol: string;
      market: string;
      event_id: string | null;
      outcome_id: string | null;
      outcome_name: string | null;
      position_size: number | null;
      entry_price: number | null;
      market_price: number | null;
      updated_at: string | Date | null;
      latest_price: number | null;
    }[]
  >`
    select
      p.id,
      p.agent_id,
      p.symbol,
      p.market,
      p.event_id,
      p.outcome_id,
      p.outcome_name,
      p.position_size,
      p.entry_price,
      p.market_price,
      p.updated_at,
      latest_quote.last_price as latest_price
    from positions p
    left join lateral (
      select mds.last_price
      from market_data_snapshots mds
      left join market_instruments mi on mi.id = mds.instrument_id
      where (
        coalesce(p.outcome_id, '') <> '' and
        mds.instrument_id = p.symbol || '::' || p.outcome_id
      ) or (
        coalesce(p.outcome_id, '') = '' and (
          (mi.symbol = p.symbol and mi.market = p.market) or
          mds.instrument_id = p.symbol
        )
      )
      order by mds.quote_ts desc
      limit 1
    ) latest_quote on true
    where p.agent_id = ${agentId}
    order by p.updated_at desc, p.id asc
  `;

  return rows.map((row) => {
    const position = {
      id: row.id,
      agentId: row.agent_id,
      symbol: row.symbol,
      market: row.market as Position['market'],
      eventId: row.event_id,
      outcomeId: row.outcome_id,
      outcomeName: row.outcome_name,
      positionSize: row.position_size ?? 0,
      entryPrice: row.entry_price ?? 0,
      marketPrice: row.market_price,
      updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
    } satisfies Position;
    const marketPrice = row.latest_price ?? row.market_price ?? position.entryPrice;
    const marketValue = roundUsd(position.positionSize * marketPrice);
    const costBasis = roundUsd(position.positionSize * position.entryPrice);

    return {
      ...position,
      marketPrice,
      marketValue,
      unrealizedPnl: roundUsd(marketValue - costBasis),
    } satisfies MarkedPosition;
  });
}

async function refreshDisplayEquityFromDatabase(agentId: string) {
  const sql = getSqlClient();
  const accountRows = await sql<
    {
      initial_cash: number | null;
      available_cash: number | null;
      total_equity: number | null;
      display_equity: number | null;
      risk_tag: string | null;
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
  `;
  const account = accountRows[0] ?? null;
  if (!account) {
    return {
      initialCash: 0,
      availableCash: 0,
      totalEquity: 0,
      displayEquity: 0,
      riskTag: null,
      closeOnly: false,
      markedPositions: [],
    };
  }

  const markedPositions = await listMarkedPositionsFromDatabase(agentId);
  const grossValue = markedPositions.reduce((sum, position) => sum + position.marketValue, 0);
  const displayEquity = roundUsd((account.available_cash ?? 0) + grossValue);
  const riskTag = getRiskTagForAccount(account.available_cash ?? 0, displayEquity);
  const updatedAt = new Date().toISOString();

  await sql.begin(async (tx) => {
    await tx`
      update agent_accounts
      set
        display_equity = ${displayEquity},
        total_equity = ${displayEquity},
        risk_tag = ${riskTag},
        updated_at = ${updatedAt}
      where agent_id = ${agentId}
    `;

    for (const position of markedPositions) {
      await tx`
        update positions
        set
          market_price = ${position.marketPrice},
          updated_at = ${updatedAt}
        where id = ${position.id}
      `;
    }
  });

  return {
    initialCash: account.initial_cash ?? 0,
    availableCash: account.available_cash ?? 0,
    totalEquity: displayEquity,
    displayEquity,
    riskTag: riskTag as 'high_risk' | 'close_only' | 'terminated' | null,
    closeOnly: riskTag === 'close_only',
    markedPositions,
  };
}

export async function refreshDisplayEquity(agentId: string) {
  requireDatabaseMode();
  return refreshDisplayEquityFromDatabase(agentId);
}

export async function readMarkedPositions(agentId: string) {
  requireDatabaseMode();
  return listMarkedPositionsFromDatabase(agentId);
}
