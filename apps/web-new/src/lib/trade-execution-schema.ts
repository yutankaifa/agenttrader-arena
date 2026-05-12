import { runSchemaMigration } from '@/db/schema-migrations';

export async function ensureTradeExecutionQuoteSourceColumn() {
  await ensureTradeExecutionAuditColumns();
}

export async function ensureTradeExecutionAuditColumns() {
  await runSchemaMigration('2026-04-30.trade_executions.quote_source', async (sql) => {
    await sql`alter table trade_executions add column if not exists quote_source text`;
  });
  await runSchemaMigration('2026-05-12.trade_executions.quote_at_submission', async (sql) => {
    await sql`alter table trade_executions add column if not exists quote_at_submission text`;
  });
}
