import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { createId } from '@/db/id';
import { readStore, updateStore } from '@/db/store';
import { getRiskTagForAccount } from '@/lib/account-metrics';
import { roundUsd } from '@/lib/utils';

function isUsablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function getAgentAccountState(agentId: string) {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const [accountRows, positionRows] = await Promise.all([
      sql<
        {
          agent_id: string;
          competition_id: string | null;
          initial_cash: number | null;
          available_cash: number | null;
          total_equity: number | null;
          display_equity: number | null;
          risk_tag: string | null;
          updated_at: string | Date | null;
        }[]
      >`
        select
          agent_id,
          competition_id,
          initial_cash,
          available_cash,
          total_equity,
          display_equity,
          risk_tag,
          updated_at
        from agent_accounts
        where agent_id = ${agentId}
        limit 1
      `,
      sql<
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
        }[]
      >`
        select
          id,
          agent_id,
          symbol,
          market,
          event_id,
          outcome_id,
          outcome_name,
          position_size,
          entry_price,
          market_price,
          updated_at
        from positions
        where agent_id = ${agentId}
      `,
    ]);

    const account = accountRows[0]
      ? {
          agentId: accountRows[0].agent_id,
          competitionId: accountRows[0].competition_id ?? '',
          initialCash: accountRows[0].initial_cash ?? 0,
          availableCash: accountRows[0].available_cash ?? 0,
          totalEquity: accountRows[0].total_equity ?? 0,
          displayEquity: accountRows[0].display_equity ?? 0,
          riskTag: accountRows[0].risk_tag as
            | null
            | 'high_risk'
            | 'close_only'
            | 'terminated',
          updatedAt:
            accountRows[0].updated_at instanceof Date
              ? accountRows[0].updated_at.toISOString()
              : (accountRows[0].updated_at ?? new Date().toISOString()),
        }
      : null;

    const positions = positionRows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      symbol: row.symbol,
      market: row.market as 'stock' | 'crypto' | 'prediction',
      eventId: row.event_id,
      outcomeId: row.outcome_id,
      outcomeName: row.outcome_name,
      positionSize: row.position_size ?? 0,
      entryPrice: row.entry_price ?? 0,
      marketPrice: row.market_price,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : (row.updated_at ?? new Date().toISOString()),
    }));

    return { account, positions };
  }

  const store = readStore();
  const account = store.agentAccounts.find((item) => item.agentId === agentId) ?? null;
  const positions = store.positions.filter((item) => item.agentId === agentId);

  return {
    account,
    positions,
  };
}

export async function recalcAccountEquity(
  agentId: string,
  availableCash: number
): Promise<number> {
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const positionRows = await sql<
      {
        position_size: number | null;
        market_price: number | null;
        entry_price: number | null;
      }[]
    >`
      select position_size, market_price, entry_price
      from positions
      where agent_id = ${agentId}
    `;

    const positionValue = positionRows.reduce((sum, position) => {
      const price = isUsablePrice(position.market_price)
        ? position.market_price
        : (position.entry_price ?? 0);
      return sum + (position.position_size ?? 0) * price;
    }, 0);

    return roundUsd(availableCash + positionValue);
  }

  const store = readStore();
  const positions = store.positions.filter((item) => item.agentId === agentId);
  const positionValue = positions.reduce((sum, position) => {
    const price = isUsablePrice(position.marketPrice)
      ? position.marketPrice
      : position.entryPrice;
    return sum + position.positionSize * price;
  }, 0);

  return roundUsd(availableCash + positionValue);
}

export async function updateAgentAccountState(input: {
  agentId: string;
  availableCash: number;
}) {
  const { agentId, availableCash } = input;
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const accountRows = await sql<{ risk_tag: string | null }[]>`
      select risk_tag
      from agent_accounts
      where agent_id = ${agentId}
      limit 1
    `;
    const previousRiskTag = accountRows[0]?.risk_tag ?? null;
    const totalEquity = await recalcAccountEquity(agentId, availableCash);
    const nextRiskTag = getRiskTagForAccount(availableCash, totalEquity);

    await sql`
      update agent_accounts
      set
        available_cash = ${availableCash},
        total_equity = ${totalEquity},
        display_equity = ${totalEquity},
        risk_tag = ${nextRiskTag},
        updated_at = ${new Date().toISOString()}
      where agent_id = ${agentId}
    `;

    return {
      previousRiskTag,
      riskTag: nextRiskTag,
      totalEquity,
    };
  }

  const store = readStore();
  const account = store.agentAccounts.find((item) => item.agentId === agentId) ?? null;
  const previousRiskTag = account?.riskTag ?? null;
  const totalEquity = await recalcAccountEquity(agentId, availableCash);
  const nextRiskTag = getRiskTagForAccount(availableCash, totalEquity);

  await updateStore((draft) => {
    const target = draft.agentAccounts.find((item) => item.agentId === agentId);
    if (!target) {
      return;
    }
    target.availableCash = availableCash;
    target.totalEquity = totalEquity;
    target.displayEquity = totalEquity;
    target.riskTag = nextRiskTag;
    target.updatedAt = new Date().toISOString();
  });

  return {
    previousRiskTag,
    riskTag: nextRiskTag,
    totalEquity,
  };
}

export async function upsertAgentPosition(input: {
  agentId: string;
  symbol: string;
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  addUnits: number;
  price: number;
}) {
  const { agentId, symbol, market, eventId, outcomeId, outcomeName, addUnits, price } = input;
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const existing = await sql<
      {
        id: string;
        event_id: string | null;
        outcome_id: string | null;
        outcome_name: string | null;
        position_size: number | null;
        entry_price: number | null;
      }[]
    >`
      select
        id,
        event_id,
        outcome_id,
        outcome_name,
        position_size,
        entry_price
      from positions
      where agent_id = ${agentId}
        and symbol = ${symbol}
        and market = ${market}
        and coalesce(event_id, '') = ${eventId ?? ''}
        and coalesce(outcome_id, '') = ${outcomeId ?? ''}
      limit 1
    `;

    if (existing[0]) {
      const position = existing[0];
      const oldUnits = position.position_size ?? 0;
      const oldEntryPrice = position.entry_price ?? price;
      const newUnits = oldUnits + addUnits;
      const newEntryPrice = (oldUnits * oldEntryPrice + addUnits * price) / newUnits;

      await sql`
        update positions
        set
          position_size = ${newUnits},
          entry_price = ${Math.round(newEntryPrice * 10000) / 10000},
          market_price = ${price},
          event_id = ${eventId ?? position.event_id ?? null},
          outcome_id = ${outcomeId ?? position.outcome_id ?? null},
          outcome_name = ${outcomeName ?? position.outcome_name ?? null},
          updated_at = ${new Date().toISOString()}
        where id = ${position.id}
      `;
      return;
    }

    await sql`
      insert into positions (
        id,
        agent_id,
        symbol,
        market,
        event_id,
        outcome_id,
        outcome_name,
        position_size,
        entry_price,
        market_price,
        updated_at
      ) values (
        ${createId('pos')},
        ${agentId},
        ${symbol},
        ${market},
        ${eventId ?? null},
        ${outcomeId ?? null},
        ${outcomeName ?? null},
        ${addUnits},
        ${price},
        ${price},
        ${new Date().toISOString()}
      )
    `;
    return;
  }

  await updateStore((store) => {
    const existing = store.positions.find(
      (item) =>
        item.agentId === agentId &&
        item.symbol === symbol &&
        item.market === market &&
        (item.eventId ?? null) === (eventId ?? null) &&
        (item.outcomeId ?? null) === (outcomeId ?? null)
    );

    if (existing) {
      const oldUnits = existing.positionSize;
      const newUnits = oldUnits + addUnits;
      existing.entryPrice = roundUsd((oldUnits * existing.entryPrice + addUnits * price) / newUnits);
      existing.positionSize = newUnits;
      existing.marketPrice = price;
      existing.eventId = eventId ?? existing.eventId ?? null;
      existing.outcomeId = outcomeId ?? existing.outcomeId ?? null;
      existing.outcomeName = outcomeName ?? existing.outcomeName ?? null;
      existing.updatedAt = new Date().toISOString();
      return;
    }

    store.positions.push({
      id: createId('pos'),
      agentId,
      symbol,
      market: market as 'stock' | 'crypto' | 'prediction',
      eventId: eventId ?? null,
      outcomeId: outcomeId ?? null,
      outcomeName: outcomeName ?? null,
      positionSize: addUnits,
      entryPrice: price,
      marketPrice: price,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function reduceAgentPosition(input: {
  agentId: string;
  symbol: string;
  market?: string | null;
  eventId?: string | null;
  outcomeId?: string | null;
  reduceUnits: number;
  price: number;
}) {
  const { agentId, symbol, market, eventId, outcomeId, reduceUnits, price } = input;
  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const existing = await sql<
      {
        id: string;
        position_size: number | null;
      }[]
    >`
      select id, position_size
      from positions
      where agent_id = ${agentId}
        and symbol = ${symbol}
        and coalesce(market, '') = ${market ?? ''}
        and coalesce(event_id, '') = ${eventId ?? ''}
        and coalesce(outcome_id, '') = ${outcomeId ?? ''}
      limit 1
    `;

    const position = existing[0] ?? null;
    if (!position) return null;

    const heldUnits = position.position_size ?? 0;
    const remainingUnits = heldUnits - reduceUnits;
    if (remainingUnits <= 0.000001) {
      await sql`delete from positions where id = ${position.id}`;
    } else {
      await sql`
        update positions
        set
          position_size = ${remainingUnits},
          market_price = ${price},
          updated_at = ${new Date().toISOString()}
        where id = ${position.id}
      `;
    }

    return {
      heldUnits,
      remainingUnits: Math.max(0, remainingUnits),
      positionId: position.id,
    };
  }

  const store = readStore();
  const position =
    store.positions.find(
      (item) =>
        item.agentId === agentId &&
        item.symbol === symbol &&
        (market == null || item.market === market) &&
        (item.eventId ?? null) === (eventId ?? null) &&
        (item.outcomeId ?? null) === (outcomeId ?? null)
    ) ?? null;
  if (!position) return null;

  const heldUnits = position.positionSize;
  const remainingUnits = heldUnits - reduceUnits;
  await updateStore((draft) => {
    const target = draft.positions.find((item) => item.id === position.id);
    if (!target) {
      return;
    }
    if (remainingUnits <= 0.000001) {
      draft.positions = draft.positions.filter((item) => item.id !== position.id);
      return;
    }
    target.positionSize = remainingUnits;
    target.marketPrice = price;
    target.updatedAt = new Date().toISOString();
  });

  return {
    heldUnits,
    remainingUnits: Math.max(0, remainingUnits),
    positionId: position.id,
  };
}
