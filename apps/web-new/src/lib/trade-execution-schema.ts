import { runSchemaMigration } from '@/db/schema-migrations';

export async function ensureTradeExecutionQuoteSourceColumn() {
  await runSchemaMigration('2026-04-30.trade_executions.quote_source', async (sql) => {
    await sql`alter table trade_executions add column if not exists quote_source text`;
  });
}
