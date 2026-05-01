import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import type { MarketType, RiskTag } from '@/db/schema';
import {
  checkPredictionContractRequirement,
  getRiskTagFromDrawdown,
} from '@/lib/risk-policy';
import {
  BUY_LIMIT_RATIO,
  INITIAL_CAPITAL,
  MAX_POSITION_CONCENTRATION,
  MIN_CASH_FOR_NEW_BUYS,
} from '@/lib/trading-rules';
import { isUsStockMarketOpen } from '@/lib/us-stock-market';
export { isUsStockMarketOpen } from '@/lib/us-stock-market';

function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for risk checks');
  }
}

export async function checkTerminated(agentId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      risk_tag: string | null;
      total_equity: number | null;
    }[]
  >`
    select risk_tag, total_equity
    from agent_accounts
    where agent_id = ${agentId}
    limit 1
  `;
  const account = rows[0] ?? null;
  if (
    account?.risk_tag === 'terminated' ||
    (account?.total_equity ?? INITIAL_CAPITAL) <= 0
  ) {
    return {
      code: 'AGENT_TERMINATED',
      message: 'Agent is terminated',
      status: 403,
      details: undefined,
    };
  }
  return null;
}

export async function checkDecisionWindow(agentId: string, windowId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<{ total: number }[]>`
    select count(*)::int as total
    from decision_window_consumptions
    where agent_id = ${agentId}
      and briefing_window_id = ${windowId}
  `;
  if (Number(rows[0]?.total ?? 0) >= 1) {
    return {
      code: 'DECISION_WINDOW_LIMIT',
      message: 'Only one decision is allowed per briefing window',
      status: 409,
      details: { window_id: windowId },
    };
  }
  return null;
}

export async function checkCloseOnly(
  agentId: string,
  actions: Array<{ side: 'buy' | 'sell' }>
) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      risk_tag: string | null;
      available_cash: number | null;
    }[]
  >`
    select risk_tag, available_cash
    from agent_accounts
    where agent_id = ${agentId}
    limit 1
  `;
  const account = rows[0] ?? null;
  if (!account) return null;
  if (
    account.risk_tag !== 'close_only' &&
    (account.available_cash ?? 0) >= MIN_CASH_FOR_NEW_BUYS
  ) {
    return null;
  }

  const hasBuy = actions.some((item) => item.side === 'buy');
  if (!hasBuy) return null;

  return {
    code: 'CLOSE_ONLY_MODE',
    message: 'Account is in close-only mode',
    status: 403,
    details: undefined,
  };
}

export async function checkBuyLimit(
  agentId: string,
  actions: Array<{ side: 'buy' | 'sell'; amount_usd: number }>
) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<{ total_equity: number | null }[]>`
    select total_equity
    from agent_accounts
    where agent_id = ${agentId}
    limit 1
  `;
  const account = rows[0] ?? null;
  if (!account) return null;
  const maxAllowedUsd = (account.total_equity ?? 0) * BUY_LIMIT_RATIO;
  const violation = actions.find(
    (item) => item.side === 'buy' && item.amount_usd > maxAllowedUsd
  );
  if (!violation) return null;

  return {
    code: 'BUY_LIMIT_EXCEEDED',
    message: 'Buy action exceeds the single-order notional cap',
    status: 403,
    details: { max_allowed_usd: Math.round(maxAllowedUsd * 100) / 100 },
  };
}

export async function checkPositionConcentration(
  agentId: string,
  actions: Array<{
    side: 'buy' | 'sell';
    symbol: string;
    amount_usd: number;
    market: MarketType;
    event_id?: string | null;
    outcome_id?: string | null;
  }>
) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const accountRows = await sql<{ total_equity: number | null }[]>`
    select total_equity
    from agent_accounts
    where agent_id = ${agentId}
    limit 1
  `;
  const account = accountRows[0] ?? null;
  if (!account) return null;
  const maxExposureUsd = (account.total_equity ?? 0) * MAX_POSITION_CONCENTRATION;

  for (const action of actions) {
    if (action.side !== 'buy') continue;
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
        and symbol = ${action.symbol}
        and market = ${action.market}
        and coalesce(event_id, '') = ${action.event_id ?? ''}
        and coalesce(outcome_id, '') = ${action.outcome_id ?? ''}
      limit 1
    `;
    const position = positionRows[0] ?? null;
    const currentExposure =
      (position?.position_size ?? 0) * (position?.market_price ?? position?.entry_price ?? 0);
    if (currentExposure + action.amount_usd > maxExposureUsd) {
      return {
        code: 'POSITION_CONCENTRATION_LIMIT',
        message: 'Position concentration limit exceeded',
        status: 403,
        details: {
          max_allowed_usd: Math.round(maxExposureUsd * 100) / 100,
          current_exposure_usd: Math.round(currentExposure * 100) / 100,
        },
      };
    }
  }

  return null;
}

export async function checkPredictionRules(
  _agentId: string,
  actions: Array<{ market: MarketType; outcome_id?: string | null }>
) {
  return checkPredictionContractRequirement(actions);
}

export async function checkPredictionPositionUniqueness(
  agentId: string,
  action: {
    symbol: string;
    side: string;
    market: string;
    event_id?: string | null;
    outcome_id?: string | null;
  }
) {
  if (action.market !== 'prediction' || action.side !== 'buy') {
    return null;
  }

  requireDatabaseMode();
  const sql = getSqlClient();
  const eventId = action.event_id ?? action.symbol;
  const outcomeId = action.outcome_id ?? action.symbol;
  const rows = await sql<
    {
      symbol: string;
      outcome_id: string | null;
      outcome_name: string | null;
    }[]
  >`
    select symbol, outcome_id, outcome_name
    from positions
    where agent_id = ${agentId}
      and market = 'prediction'
      and event_id = ${eventId}
      and coalesce(outcome_id, symbol) <> ${outcomeId}
    limit 1
  `;
  const conflict = rows[0] ?? null;
  if (!conflict) {
    return null;
  }

  return {
    code: 'PREDICTION_POSITION_CONFLICT',
    message: 'Only one prediction outcome may be held per event at a time',
    details: {
      event_id: eventId,
      existing_symbol: conflict.symbol,
      existing_outcome_id: conflict.outcome_id,
      existing_outcome_name: conflict.outcome_name,
      requested_outcome_id: outcomeId,
    },
    status: 400,
  };
}

export async function checkMarketSession(
  actions: Array<{ market: MarketType }>
) {
  const hasStocks = actions.some((item) => item.market === 'stock');
  if (!hasStocks || isUsStockMarketOpen()) {
    return null;
  }

  return {
    code: 'MARKET_CLOSED',
    message: 'US stock market is closed',
    status: 403,
    details: undefined,
  };
}

export { getRiskTagFromDrawdown };
