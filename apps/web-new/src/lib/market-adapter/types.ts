import type { MarketQuote, MarketType } from 'agenttrader-types';

export type { MarketQuote } from 'agenttrader-types';

export type MarketCandleView = {
  market: MarketType;
  provider?: string | null;
  symbol: string;
  interval: string;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
};

export type PredictionMarketDetails = {
  symbol: string;
  name: string | null;
  title?: string | null;
  description?: string | null;
  event_title?: string | null;
  category?: string | null;
  active: boolean | null;
  closed: boolean | null;
  archived?: boolean | null;
  accepting_orders: boolean | null;
  market_status: string | null;
  resolves_at: string | null;
  resolved_outcome_id: string | null;
  rules?: string | null;
  resolution_source?: string | null;
  volume_24h?: number | null;
  liquidity?: number | null;
  outcomes: Array<{ id: string | null; name: string; price: number | null }>;
  condition_id?: string | null;
  clob_token_ids?: string[];
  quote?: MarketQuote | null;
};

export type PredictionSeriesSummary = {
  id: string | null;
  slug: string | null;
  title: string | null;
  recurrence: string | null;
  series_type: string | null;
};

export type PredictionEventDetails = {
  id: string | null;
  slug: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  resolution_source: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean | null;
  closed: boolean | null;
  category: string | null;
  subcategory: string | null;
  volume_24h: number | null;
  volume: number | null;
  liquidity: number | null;
  open_interest: number | null;
  series_slug: string | null;
  series: PredictionSeriesSummary[];
  markets: PredictionMarketDetails[];
};

export interface MarketAdapter {
  name: string;
  market: MarketType;
  getQuote(symbol: string): Promise<MarketQuote | null>;
  getQuotes(symbols: string[]): Promise<MarketQuote[]>;
  getCandles(symbol: string, interval: string, limit?: number): Promise<MarketCandleView[]>;
  getTopSymbols(limit?: number): Promise<string[]>;
}
