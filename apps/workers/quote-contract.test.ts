import assert from 'node:assert/strict';
import { quoteKey } from 'agenttrader-types';

import { buildStoredPolymarketQuote } from './polymarket-quote.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest(
  'quoteKey normalizes stock and crypto symbols into the canonical market-prefixed key',
  () => {
    assert.equal(
      quoteKey({
        symbol: ' aapl ',
        market: 'stock',
      }),
      'market:quote:stock:AAPL'
    );

    assert.equal(
      quoteKey({
        symbol: ' btc ',
        market: 'crypto',
      }),
      'market:quote:crypto:BTC'
    );
  }
);

runTest('quoteKey only appends outcome ids for prediction markets', () => {
  assert.equal(
    quoteKey({
      symbol: 'fed-june-decision',
      market: 'prediction',
      outcomeId: ' yes_token ',
    }),
    'market:quote:prediction:FED-JUNE-DECISION:YES_TOKEN'
  );

  assert.equal(
    quoteKey({
      symbol: 'fed-june-decision',
      market: 'prediction',
      outcomeId: null,
    }),
    'market:quote:prediction:FED-JUNE-DECISION'
  );
});

runTest('buildStoredPolymarketQuote keeps each outcome bound to its own top of book', () => {
  const noQuote = buildStoredPolymarketQuote({
    symbol: 'fed-june-decision',
    lastPrice: 0.9695,
    volume24h: 1000,
    change24h: 1.25,
    timestamp: '2026-05-01T00:00:00.000Z',
    book: {
      bid: 0.969,
      ask: 0.97,
    },
    outcomeId: 'no-token',
    outcomeName: 'No',
  });

  assert.equal(noQuote.lastPrice, 0.9695);
  assert.equal(noQuote.bid, 0.969);
  assert.equal(noQuote.ask, 0.97);
  assert.equal(noQuote.midpoint, 0.9695);
  assert.equal(noQuote.spread, 0.0010000000000000009);
  assert.equal(noQuote.outcomeId, 'no-token');
  assert.equal(noQuote.outcomeName, 'No');
});
