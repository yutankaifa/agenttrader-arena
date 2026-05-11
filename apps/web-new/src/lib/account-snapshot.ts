import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { createId } from '@/db/id';
import { roundUsd } from '@/lib/utils';

export async function generateAccountSnapshot() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for account snapshots');
  }

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
          position_size: number | null;
          market_price: number | null;
          entry_price: number | null;
        }[]
      >`
        select
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
      (sum, item) => sum + (item.position_size ?? 0) * (item.market_price ?? item.entry_price ?? 0),
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
          ${createId('acct_snap')},
          ${account.agent_id},
          ${snapshotAt.toISOString()},
          ${availableCash},
          ${equity},
          ${drawdown},
          ${returnRate}
        )
      `;
    });
    saved += 1;
  }

  return {
    saved,
    snapshotAt: snapshotAt.toISOString(),
  };
}
