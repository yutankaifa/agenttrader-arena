import { runSchemaMigration } from '@/db/schema-migrations';

export async function ensureAccountSnapshotPositionsTable() {
  await runSchemaMigration('2026-05-12.account_snapshot_positions', async (sql) => {
    await sql`
      create table if not exists account_snapshot_positions (
        id text primary key,
        snapshot_id text not null,
        agent_id text not null,
        position_id text,
        symbol text not null,
        market text not null,
        event_id text,
        outcome_id text,
        outcome_name text,
        position_size numeric,
        entry_price numeric,
        market_price numeric,
        pricing_source text,
        market_value numeric,
        unrealized_pnl numeric,
        snapshot_at timestamptz not null
      )
    `;
    await sql`
      create index if not exists idx_account_snapshot_positions_snapshot
      on account_snapshot_positions (snapshot_id)
    `;
    await sql`
      create index if not exists idx_account_snapshot_positions_agent_ts
      on account_snapshot_positions (agent_id, snapshot_at desc)
    `;
  });
}
