import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { createId } from '@/db/id';
import { ensureAccountSnapshotPositionsTable } from '@/lib/account-snapshot-schema';
import { roundUsd } from '@/lib/utils';

export async function generateAccountSnapshot() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for account snapshots');
  }

  await ensureAccountSnapshotPositionsTable();

  const snapshotAt = new Date();
  let saved = 0;
  const sql = getSqlClient();
  const accountRows = await sql<
    {
      agent_id: string;
      initial_cash: number | null;
      available_cash: number | null;
    }[]
  >`
    select
      agent_id,
      initial_cash,
      available_cash
    from agent_accounts
  `;

  for (const account of accountRows) {
    const [positionRows, historicalRows] = await Promise.all([
      sql<
        {
          id: string;
          symbol: string;
          market: string;
          event_id: string | null;
          outcome_id: string | null;
          outcome_name: string | null;
          position_size: number | null;
          market_price: number | null;
          entry_price: number | null;
        }[]
      >`
        select
          id,
          symbol,
          market,
          event_id,
          outcome_id,
          outcome_name,
          position_size,
          market_price,
          entry_price
        from positions
        where agent_id = ${account.agent_id}
      `,
      sql<{ equity: number | null }[]>`
        select equity
        from account_snapshots
        where agent_id = ${account.agent_id}
        order by ts asc
      `,
    ]);

    const positionValue = positionRows.reduce(
      (sum, item) => sum + getSnapshotPositionMarketValue(item),
      0
    );
    const availableCash = account.available_cash ?? 0;
    const initialCash = account.initial_cash ?? 0;
    const equity = roundUsd(availableCash + positionValue);
    const peak = Math.max(
      initialCash,
      ...historicalRows.map((item) => item.equity ?? 0),
      equity
    );
    const drawdown = peak > 0 ? roundUsd(((equity - peak) / peak) * 100) : 0;
    const returnRate =
      initialCash > 0 ? roundUsd(((equity - initialCash) / initialCash) * 100) : 0;

    const snapshotId = createId('acct_snap');
    await sql.begin(async (tx) => {
      await tx`
        update agent_accounts
        set
          total_equity = ${equity},
          display_equity = ${equity},
          updated_at = ${snapshotAt.toISOString()}
        where agent_id = ${account.agent_id}
      `;

      await tx`
        insert into account_snapshots (
          id,
          agent_id,
          ts,
          cash,
          equity,
          drawdown,
          return_rate
        ) values (
          ${snapshotId},
          ${account.agent_id},
          ${snapshotAt.toISOString()},
          ${availableCash},
          ${equity},
          ${drawdown},
          ${returnRate}
        )
      `;

      for (const position of positionRows) {
        const positionSize = position.position_size ?? 0;
        const entryPrice = position.entry_price ?? null;
        const marketPrice = position.market_price ?? entryPrice ?? 0;
        const pricingSource =
          position.market_price != null ? 'market_price' : 'entry_price_fallback';
        const marketValue = roundUsd(positionSize * marketPrice);
        const unrealizedPnl =
          entryPrice == null ? 0 : roundUsd((marketPrice - entryPrice) * positionSize);

        await tx`
          insert into account_snapshot_positions (
            id,
            snapshot_id,
            agent_id,
            position_id,
            symbol,
            market,
            event_id,
            outcome_id,
            outcome_name,
            position_size,
            entry_price,
            market_price,
            pricing_source,
            market_value,
            unrealized_pnl,
            snapshot_at
          ) values (
            ${createId('acct_snap_pos')},
            ${snapshotId},
            ${account.agent_id},
            ${position.id},
            ${position.symbol},
            ${position.market},
            ${position.event_id},
            ${position.outcome_id},
            ${position.outcome_name},
            ${positionSize},
            ${entryPrice},
            ${marketPrice},
            ${pricingSource},
            ${marketValue},
            ${unrealizedPnl},
            ${snapshotAt.toISOString()}
          )
        `;
      }
    });
    saved += 1;
  }

  return {
    saved,
    snapshotAt: snapshotAt.toISOString(),
  };
}

function getSnapshotPositionMarketValue(position: {
  position_size: number | null;
  market_price: number | null;
  entry_price: number | null;
}) {
  return roundUsd(
    (position.position_size ?? 0) * (position.market_price ?? position.entry_price ?? 0)
  );
}
