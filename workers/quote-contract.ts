export type WorkerMarketType = 'stock' | 'crypto' | 'prediction';

type QuoteKeyInput = {
  symbol: string;
  market: WorkerMarketType;
  outcomeId?: string | null;
};

function normalizeQuoteKeyPart(value: string) {
  return value.trim().toUpperCase();
}

export function quoteKey(input: QuoteKeyInput) {
  const outcomePart =
    input.market === 'prediction' && input.outcomeId
      ? `:${normalizeQuoteKeyPart(input.outcomeId)}`
      : '';

  return `market:quote:${input.market}:${normalizeQuoteKeyPart(input.symbol)}${outcomePart}`;
}
