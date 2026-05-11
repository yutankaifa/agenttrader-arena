import assert from 'node:assert/strict';

import {
  buildPredictionSearchFallbackSuggestions,
  buildPredictionSearchQuery,
} from '../src/lib/prediction-search.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('buildPredictionSearchQuery strips pm prefixes for prediction searches', () => {
  assert.equal(buildPredictionSearchQuery('pm:fed'), 'fed');
  assert.equal(buildPredictionSearchQuery('pm_event:fed-decision-in-june-825'), 'fed-decision-in-june-825');
});

runTest('buildPredictionSearchQuery extracts canonical slugs from Polymarket URLs', () => {
  assert.equal(
    buildPredictionSearchQuery('https://polymarket.com/event/fed-decision-in-june-825'),
    'fed-decision-in-june-825'
  );
  assert.equal(
    buildPredictionSearchQuery('https://polymarket.com/market/will-the-fed-decrease-interest-rates-by-25-bps-after-the-june-2026-meeting'),
    'will-the-fed-decrease-interest-rates-by-25-bps-after-the-june-2026-meeting'
  );
});

runTest('buildPredictionSearchFallbackSuggestions returns stable search refinements', () => {
  assert.deepEqual(buildPredictionSearchFallbackSuggestions('fed'), [
    'fed',
    'fed prediction',
    'fed polymarket',
  ]);
});
