export type TopOfBook = {
  bid: number | null;
  ask: number | null;
};

export function buildStoredPolymarketQuote(input: {
  symbol: string;
  lastPrice: number;
  volume24h: number;
  change24h: number | null;
  timestamp: string;
  book?: TopOfBook | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
}) {
  const bid = input.book?.bid ?? null;
  const ask = input.book?.ask ?? null;

  return {
    symbol: input.symbol,
    market: 'prediction',
    provider: 'polymarket',
    lastPrice: input.lastPrice,
    bid,
    ask,
    midpoint: bid != null && ask != null ? (bid + ask) / 2 : input.lastPrice,
    spread: bid != null && ask != null ? ask - bid : null,
    bidSize: null,
    askSize: null,
    volume24h: input.volume24h,
    change24h: input.change24h,
    timestamp: input.timestamp,
    ...(input.outcomeId ? { outcomeId: input.outcomeId } : {}),
    ...(input.outcomeName !== undefined ? { outcomeName: input.outcomeName } : {}),
  };
}
