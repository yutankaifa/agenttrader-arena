import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function withEnv(
  patch: Record<string, string | undefined>,
  run: () => void | Promise<void>
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve(run()).finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function withSilencedConsoleError(run: () => void | Promise<void>) {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    await run();
  } finally {
    console.error = originalConsoleError;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function agentErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status?: number
) {
  return jsonResponse({ code, message, details }, status ?? 500);
}

function agentSuccessResponse<T>(data: T) {
  return jsonResponse(data);
}

function wrappedAgentSuccessResponse<T>(data: T) {
  return jsonResponse({ ok: true, data });
}

async function readJson(response: Response) {
  return response.json();
}

function normalizeSqlText(strings: TemplateStringsArray) {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

function createSqlRecorder() {
  const operations: Array<{
    kind: 'query' | 'begin';
    text: string;
    values: unknown[];
  }> = [];

  type RecordedSql = ((
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown[]>) & {
    begin: <T>(run: (inner: RecordedSql) => Promise<T>) => Promise<T>;
  };

  const tx = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    operations.push({
      kind: 'query',
      text: normalizeSqlText(strings),
      values,
    });
    return [];
  }) as unknown as RecordedSql;

  tx.begin = async <T>(run: (inner: RecordedSql) => Promise<T>) => {
    operations.push({
      kind: 'begin',
      text: 'begin',
      values: [],
    });
    return run(tx);
  };

  return {
    sql: tx,
    operations,
  };
}

const {
  extractCronSecretFromRequest,
  verifyProvidedCronSecret,
  verifyCronRequestWithExpectedSecret,
} = await import(
  new URL('../src/lib/cron-auth-core.ts', import.meta.url).href
);
const { getUsStockMarketSession, isUsStockMarketOpen } = await import(
  new URL('../src/lib/us-stock-market-core.ts', import.meta.url).href
);
const { checkPredictionContractRequirement, getRiskTagFromDrawdown } =
  await import(new URL('../src/lib/risk-policy.ts', import.meta.url).href);
const {
  buildStoredDetailRequestPayload,
  evaluatePredictionDecisionContext,
} = await import(
  new URL('../src/lib/prediction-detail-contract.ts', import.meta.url).href
);
const { resolveExecutionQuote } = await import(
  new URL('../src/lib/execution-quote-resolver.ts', import.meta.url).href
);
const { derivePredictionDecisionSymbol } = await import(
  new URL('../src/lib/agent-decision-service.ts', import.meta.url).href
);
const { buildTradableObjects } = await import(
  new URL('../src/lib/agent-detail-request-tradeability.ts', import.meta.url).href
);
const { buildPredictionOutcomeQuoteContext } = await import(
  new URL('../src/lib/agent-detail-request-market-data.ts', import.meta.url).href
);
const { buildArenaStatusStripModel } = await import(
  new URL('../src/lib/arena-status-strip-model.ts', import.meta.url).href
);
const { buildSeedStore } = await import(
  new URL('../src/db/seed.ts', import.meta.url).href
);
const {
  buildDecisionPersistencePlan,
  buildDetailRequestPersistenceRow,
  summarizeDecisionExecution,
} = await import(
  new URL('../src/lib/agent-persistence-plan.ts', import.meta.url).href
);
const {
  writeDecisionPersistencePlan,
  updateDecisionSubmissionExecutionResult,
  writeDetailRequestPersistenceRow,
} = await import(
  new URL('../src/lib/agent-persistence-db.ts', import.meta.url).href
);
const { polymarketAdapter } = await import(
  new URL('../src/lib/market-adapter/index.ts', import.meta.url).href
);
const {
  handleAgentDecisionPost,
  handleAgentDetailRequestPost,
} = await import(
  new URL('../src/lib/agent-route-handlers.ts', import.meta.url).href
);
const { handleCronJobGet } = await import(
  new URL('../src/lib/cron-route-handler.ts', import.meta.url).href
);

await runTest('verifyCronRequestWithExpectedSecret accepts x-cron-secret header', async () => {
  await withEnv(
    {
      NODE_ENV: 'test',
      CRON_SECRET: 'unit-test-secret',
    },
    () => {
      const request = new Request('https://example.com/api/cron/market-refresh', {
        headers: {
          'x-cron-secret': 'unit-test-secret',
        },
      });

      assert.equal(
        verifyCronRequestWithExpectedSecret(request, 'unit-test-secret'),
        true
      );
    }
  );
});

await runTest('extractCronSecretFromRequest prefers x-cron-secret over bearer fallback', () => {
  const request = new Request('https://example.com/api/cron/market-refresh', {
    headers: {
      'x-cron-secret': 'preferred-secret',
      authorization: 'Bearer fallback-secret',
    },
  });

  assert.equal(extractCronSecretFromRequest(request), 'preferred-secret');
});

await runTest('verifyProvidedCronSecret compares the supplied and expected shared secrets', () => {
  assert.equal(verifyProvidedCronSecret('abc', 'abc'), true);
  assert.equal(verifyProvidedCronSecret('abc', 'def'), false);
  assert.equal(verifyProvidedCronSecret('', 'def'), false);
});

await runTest(
  'verifyCronRequestWithExpectedSecret accepts bearer authorization fallback',
  async () => {
  await withEnv(
    {
      NODE_ENV: 'test',
      CRON_SECRET: 'unit-test-secret',
    },
    () => {
      const request = new Request('https://example.com/api/cron/account-snapshot', {
        headers: {
          authorization: 'Bearer unit-test-secret',
        },
      });

      assert.equal(
        verifyCronRequestWithExpectedSecret(request, 'unit-test-secret'),
        true
      );
    }
  );
});

await runTest(
  'verifyCronRequestWithExpectedSecret rejects missing or incorrect secrets',
  async () => {
  await withEnv(
    {
      NODE_ENV: 'test',
      CRON_SECRET: 'unit-test-secret',
    },
    () => {
      const wrongSecretRequest = new Request('https://example.com/api/cron/leaderboard', {
        headers: {
          'x-cron-secret': 'wrong-secret',
        },
      });
      const missingSecretRequest = new Request('https://example.com/api/cron/leaderboard');

      assert.equal(
        verifyCronRequestWithExpectedSecret(wrongSecretRequest, 'unit-test-secret'),
        false
      );
      assert.equal(
        verifyCronRequestWithExpectedSecret(missingSecretRequest, 'unit-test-secret'),
        false
      );
    }
  );
});

await runTest(
  'verifyCronRequestWithExpectedSecret fails closed when the shared secret does not match',
  async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        CRON_SECRET: undefined,
      },
      () =>
        withSilencedConsoleError(() => {
          const request = new Request(
            'https://example.com/api/cron/prediction-settlement',
            {
              headers: {
                'x-cron-secret': 'anything',
              },
            }
          );

          assert.equal(
            verifyCronRequestWithExpectedSecret(request, 'different-expected-secret'),
            false
          );
        })
    );
  }
);

await runTest('getUsStockMarketSession reports regular open trading hours', () => {
  const session = getUsStockMarketSession(new Date('2026-04-15T14:00:00.000Z'));

  assert.equal(session.phase, 'open');
  assert.equal(session.isOpen, true);
  assert.equal(session.isEarlyClose, false);
  assert.equal(session.minutesUntilClose, 360);
});

await runTest('getUsStockMarketSession reports weekends as closed', () => {
  const session = getUsStockMarketSession(new Date('2026-04-18T15:00:00.000Z'));

  assert.equal(session.phase, 'weekend');
  assert.equal(session.isOpen, false);
  assert.equal(session.minutesUntilOpen, null);
});

await runTest('getUsStockMarketSession reports holidays as closed', () => {
  const session = getUsStockMarketSession(new Date('2026-12-25T15:00:00.000Z'));

  assert.equal(session.phase, 'holiday');
  assert.equal(session.isOpen, false);
  assert.equal(session.minutesUntilOpen, null);
});

await runTest('getUsStockMarketSession marks the post-thanksgiving early close window', () => {
  const session = getUsStockMarketSession(new Date('2026-11-27T17:00:00.000Z'));

  assert.equal(session.phase, 'open');
  assert.equal(session.isOpen, true);
  assert.equal(session.isEarlyClose, true);
  assert.equal(session.minutesUntilClose, 60);
  assert.equal(isUsStockMarketOpen(new Date('2026-11-27T18:30:00.000Z')), false);
});

await runTest('checkPredictionContractRequirement rejects prediction trades without outcome ids', () => {
  const result = checkPredictionContractRequirement([
    {
      market: 'prediction',
      outcome_id: null,
    },
    {
      market: 'stock',
      outcome_id: null,
    },
  ]);

  assert.deepEqual(result, {
    code: 'PREDICTION_CONTRACT_REQUIRED',
    message: 'Prediction trades must target a concrete outcome',
    status: 400,
    details: undefined,
  });
});

await runTest(
  'checkPredictionContractRequirement ignores non-prediction actions and valid prediction outcomes',
  () => {
    const result = checkPredictionContractRequirement([
      {
        market: 'stock',
        outcome_id: null,
      },
      {
        market: 'prediction',
        outcome_id: 'YES_TOKEN',
      },
    ]);

    assert.equal(result, null);
  }
);

await runTest('getRiskTagFromDrawdown uses the documented threshold bands', () => {
  assert.equal(getRiskTagFromDrawdown(-10), null);
  assert.equal(getRiskTagFromDrawdown(-25), 'high_risk');
  assert.equal(getRiskTagFromDrawdown(-45), 'close_only');
  assert.equal(getRiskTagFromDrawdown(-70), 'terminated');
});

await runTest('buildStoredDetailRequestPayload preserves outcome-level execution allowlists', () => {
  const payload = buildStoredDetailRequestPayload({
    summary: {
      requested_objects: 1,
      tradable_objects: 2,
      decision_allowed_objects: 1,
    },
    objects: [
      {
        object_id: 'pm:fed-june-decision',
        canonical_object_id: 'fed-june-decision',
        market: 'prediction',
        symbol: 'FED-JUNE-DECISION',
        event_id: 'fed-june-decision',
        outcome_id: null,
        decision_allowed: false,
        allowed_actions: [],
        blocked_reason: 'PREDICTION_MARKET_CLOSED',
        quote_source: 'market_details',
        quote: {
          source: 'gamma',
          quote_timestamp: '2026-04-30T12:00:00.000Z',
          stale: false,
        },
        tradable_objects: [
          {
            object_id: 'pm:fed-june-decision:YES',
            event_id: 'fed-june-decision',
            outcome_id: 'YES_TOKEN',
            decision_allowed: true,
            allowed_actions: ['buy'],
            blocked_reason: null,
            quote: {
              source: 'clob',
              timestamp: '2026-04-30T12:00:05.000Z',
              stale: false,
            },
          },
          {
            object_id: 'pm:fed-june-decision:NO',
            canonical_object_id: 'pm:fed-june-decision:NO',
            event_id: 'fed-june-decision',
            outcome_id: 'NO_TOKEN',
            decision_allowed: false,
            allowed_actions: [],
            blocked_reason: 'QUOTE_STALE',
            quote: {
              source: 'clob',
              quote_timestamp: '2026-04-30T11:30:00.000Z',
              stale: true,
            },
          },
        ],
      },
    ],
  });

  assert.equal(typeof payload, 'string');

  const parsed = JSON.parse(payload!);
  assert.deepEqual(parsed.summary, {
    requested_objects: 1,
    tradable_objects: 2,
    decision_allowed_objects: 1,
  });
  assert.equal(parsed.objects[0].quote_source, 'gamma');
  assert.equal(parsed.objects[0].quote_timestamp, '2026-04-30T12:00:00.000Z');
  assert.equal(
    parsed.objects[0].tradable_objects[0].canonical_object_id,
    'pm:fed-june-decision:YES'
  );
  assert.equal(parsed.objects[0].tradable_objects[0].allowed_actions[0], 'buy');
  assert.equal(parsed.objects[0].tradable_objects[1].blocked_reason, 'QUOTE_STALE');
  assert.equal(parsed.objects[0].tradable_objects[1].quote_stale, true);
});

const latestPredictionDetailRequest = {
  id: 'detail_1',
  requested_at: '2026-04-30T12:01:00.000Z',
  response_summary: buildStoredDetailRequestPayload({
    summary: {
      requested_objects: 1,
      tradable_objects: 2,
      decision_allowed_objects: 1,
    },
    objects: [
      {
        object_id: 'pm:fed-june-decision',
        canonical_object_id: 'fed-june-decision',
        market: 'prediction',
        symbol: 'FED-JUNE-DECISION',
        event_id: 'fed-june-decision',
        outcome_id: null,
        decision_allowed: false,
        allowed_actions: [],
        blocked_reason: null,
        quote_source: 'gamma',
        quote: null,
        tradable_objects: [
          {
            object_id: 'pm:fed-june-decision:YES',
            canonical_object_id: 'pm:fed-june-decision:YES',
            event_id: 'fed-june-decision',
            outcome_id: 'YES_TOKEN',
            decision_allowed: true,
            allowed_actions: ['buy'],
            blocked_reason: null,
            quote: {
              source: 'clob',
              quote_timestamp: '2026-04-30T12:01:05.000Z',
              stale: false,
            },
          },
          {
            object_id: 'pm:fed-june-decision:NO',
            canonical_object_id: 'pm:fed-june-decision:NO',
            event_id: 'fed-june-decision',
            outcome_id: 'NO_TOKEN',
            decision_allowed: false,
            allowed_actions: [],
            blocked_reason: 'QUOTE_STALE',
            quote: {
              source: 'clob',
              quote_timestamp: '2026-04-30T11:40:00.000Z',
              stale: true,
            },
          },
        ],
      },
    ],
  }),
};

await runTest('evaluatePredictionDecisionContext rejects actions without a current-window detail request', () => {
  const result = evaluatePredictionDecisionContext({
    latestRequest: null,
    windowId: '2026-04-30T12:00',
    actions: [
      {
        market: 'prediction',
        side: 'buy',
        object_id: 'pm:fed-june-decision:YES',
        event_id: 'fed-june-decision',
        outcome_id: 'YES_TOKEN',
      },
    ],
  });

  assert.equal(result?.code, 'PREDICTION_DETAIL_REQUIRED');
});

await runTest('evaluatePredictionDecisionContext rejects outcomes not confirmed by the stored detail response', () => {
  const result = evaluatePredictionDecisionContext({
    latestRequest: latestPredictionDetailRequest,
    windowId: '2026-04-30T12:00',
    actions: [
      {
        market: 'prediction',
        side: 'buy',
        object_id: 'pm:fed-june-decision:MAYBE',
        event_id: 'fed-june-decision',
        outcome_id: 'MAYBE_TOKEN',
      },
    ],
  });

  assert.equal(result?.code, 'PREDICTION_OUTCOME_NOT_CONFIRMED');
});

await runTest('evaluatePredictionDecisionContext rejects stale outcome quotes', () => {
  const result = evaluatePredictionDecisionContext({
    latestRequest: latestPredictionDetailRequest,
    windowId: '2026-04-30T12:00',
    actions: [
      {
        market: 'prediction',
        side: 'buy',
        object_id: 'pm:fed-june-decision:NO',
        event_id: 'fed-june-decision',
        outcome_id: 'NO_TOKEN',
      },
    ],
  });

  assert.equal(result?.code, 'PREDICTION_QUOTE_STALE');
});

await runTest('evaluatePredictionDecisionContext rejects sides outside the stored allowlist', () => {
  const result = evaluatePredictionDecisionContext({
    latestRequest: latestPredictionDetailRequest,
    windowId: '2026-04-30T12:00',
    actions: [
      {
        market: 'prediction',
        side: 'sell',
        object_id: 'pm:fed-june-decision:YES',
        event_id: 'fed-june-decision',
        outcome_id: 'YES_TOKEN',
      },
    ],
  });

  assert.equal(result?.code, 'PREDICTION_ACTION_NOT_ALLOWED');
});

await runTest('evaluatePredictionDecisionContext accepts same-window confirmed outcomes with allowed sides', () => {
  const result = evaluatePredictionDecisionContext({
    latestRequest: latestPredictionDetailRequest,
    windowId: '2026-04-30T12:00',
    actions: [
      {
        market: 'prediction',
        side: 'buy',
        object_id: 'pm:fed-june-decision:YES',
        event_id: 'fed-june-decision',
        outcome_id: 'YES_TOKEN',
      },
    ],
  });

  assert.equal(result, null);
});

await runTest(
  'evaluatePredictionDecisionContext prefers explicit tradable outcome candidates over event-level summary rows',
  () => {
    const result = evaluatePredictionDecisionContext({
      latestRequest: {
        id: 'detail_quoted_primary',
        requested_at: '2026-04-30T12:02:00.000Z',
        response_summary: buildStoredDetailRequestPayload({
          summary: {
            requested_objects: 1,
            tradable_objects: 2,
            decision_allowed_objects: 1,
          },
          objects: [
            {
              object_id: 'pm:fed-june-decision',
              canonical_object_id: 'fed-june-decision',
              market: 'prediction',
              symbol: 'FED-JUNE-DECISION',
              event_id: 'fed-june-decision',
              outcome_id: 'YES_TOKEN',
              decision_allowed: false,
              allowed_actions: [],
              blocked_reason: 'SELECT_TRADABLE_OUTCOME_REQUIRED',
              quote_source: 'db',
              quote: {
                source: 'db',
                quote_timestamp: '2026-04-30T12:02:00.000Z',
                stale: false,
              },
              tradable_objects: [
                {
                  object_id: 'pm:fed-june-decision:YES',
                  canonical_object_id: 'pm:fed-june-decision:YES',
                  event_id: 'fed-june-decision',
                  outcome_id: 'YES_TOKEN',
                  decision_allowed: true,
                  allowed_actions: ['buy'],
                  blocked_reason: null,
                  quote: {
                    source: 'db',
                    quote_timestamp: '2026-04-30T12:02:01.000Z',
                    stale: false,
                  },
                },
              ],
            },
          ],
        }),
      },
      windowId: '2026-04-30T12:00',
      actions: [
        {
          market: 'prediction',
          side: 'buy',
          object_id: 'pm:fed-june-decision:YES',
          event_id: 'fed-june-decision',
          outcome_id: 'YES_TOKEN',
        },
      ],
    });

    assert.equal(result, null);
  }
);

await runTest(
  'resolveExecutionQuote binds to the last pre-submission db snapshot before newer quotes',
  async () => {
    let latestCalled = false;
    let redisCalled = false;
    let liveCalled = false;
    const result = await resolveExecutionQuote({
      instrumentId: 'AAPL',
      action: {
        market: 'stock',
        side: 'buy',
      },
      executedAt: new Date('2026-04-30T12:00:00.000Z'),
      redisConfigured: true,
      getDbBeforeSubmission: async () => ({
        provider: 'massive',
        quoteTs: '2026-04-30T11:59:30.000Z',
        lastPrice: 100,
        bid: 99,
        ask: 101,
        midpoint: 100,
        spread: 2,
        bidSize: 25,
        askSize: 20,
        depthSnapshot: null,
      }),
      getDbLatest: async () => {
        latestCalled = true;
        return null;
      },
      getRedisQuote: async () => {
        redisCalled = true;
        return null;
      },
      getLiveQuote: async () => {
        liveCalled = true;
        return null;
      },
    });

    assert.equal(result.method, 'walk_book');
    assert.equal(result.source, 'db:massive');
    assert.equal(result.price, 101);
    assert.equal(result.quoteAtSubmission?.timestamp, '2026-04-30T11:59:30.000Z');
    assert.equal(result.quoteDebug.db_before_submission.status, 'hit');
    assert.equal(latestCalled, false);
    assert.equal(redisCalled, false);
    assert.equal(liveCalled, false);
  }
);

await runTest(
  'resolveExecutionQuote falls back to a recent db snapshot within execution tolerance',
  async () => {
    let redisCalled = false;
    let liveCalled = false;
    const result = await resolveExecutionQuote({
      instrumentId: 'BTCUSD',
      action: {
        market: 'crypto',
        side: 'sell',
      },
      executedAt: new Date('2026-04-30T12:00:00.000Z'),
      redisConfigured: true,
      getDbBeforeSubmission: async () => null,
      getDbLatest: async () => ({
        provider: 'binance',
        quoteTs: '2026-04-30T12:01:00.000Z',
        lastPrice: 65000,
        bid: 64990,
        ask: 65010,
        midpoint: 65000,
        spread: 20,
        bidSize: 1.5,
        askSize: 1.1,
        depthSnapshot: null,
      }),
      getRedisQuote: async () => {
        redisCalled = true;
        return null;
      },
      getLiveQuote: async () => {
        liveCalled = true;
        return null;
      },
    });

    assert.equal(result.method, 'db_recent_quote');
    assert.equal(result.source, 'db:binance');
    assert.equal(result.price, 64990);
    assert.equal(result.quoteDebug.db_before_submission.status, 'miss');
    assert.equal(result.quoteDebug.db_latest.status, 'hit');
    assert.equal(redisCalled, false);
    assert.equal(liveCalled, false);
  }
);

await runTest(
  'resolveExecutionQuote marks stale db snapshots and falls back to redis quotes',
  async () => {
    let liveCalled = false;
    const result = await resolveExecutionQuote({
      instrumentId: 'ETHUSD',
      action: {
        market: 'crypto',
        side: 'buy',
      },
      executedAt: new Date('2026-04-30T12:00:00.000Z'),
      redisConfigured: true,
      getDbBeforeSubmission: async () => null,
      getDbLatest: async () => ({
        provider: 'binance',
        quoteTs: '2026-04-30T11:50:00.000Z',
        lastPrice: 3000,
        bid: 2998,
        ask: 3002,
        midpoint: 3000,
        spread: 4,
        bidSize: 4,
        askSize: 5,
        depthSnapshot: null,
      }),
      getRedisQuote: async () => ({
        provider: 'binance',
        timestamp: '2026-04-30T12:00:03.000Z',
        lastPrice: 3001,
        bid: 3000,
        ask: 3002,
        midpoint: 3001,
        spread: 2,
        bidSize: 2,
        askSize: 3,
        depthSnapshot: null,
      }),
      getLiveQuote: async () => {
        liveCalled = true;
        return null;
      },
    });

    assert.equal(result.method, 'redis_quote');
    assert.equal(result.source, 'redis:binance');
    assert.equal(result.price, 3002);
    assert.equal(result.quoteDebug.db_latest.status, 'stale');
    assert.equal(result.quoteDebug.redis.status, 'hit');
    assert.equal(liveCalled, false);
  }
);

await runTest(
  'resolveExecutionQuote rejects prediction quotes when the last price sits outside the top of book',
  async () => {
    const result = await resolveExecutionQuote({
      instrumentId: 'FED-JUNE-DECISION::YES_TOKEN',
      action: {
        market: 'prediction',
        side: 'buy',
      },
      executedAt: new Date('2026-04-30T12:00:00.000Z'),
      redisConfigured: false,
      getDbBeforeSubmission: async () => ({
        provider: 'polymarket',
        quoteTs: '2026-04-30T11:59:45.000Z',
        lastPrice: 0.9,
        bid: 0.4,
        ask: 0.6,
        midpoint: 0.5,
        spread: 0.2,
        bidSize: 100,
        askSize: 100,
        depthSnapshot: null,
      }),
      getDbLatest: async () => null,
      getLiveQuote: async () => null,
    });

    assert.equal(result.method, 'walk_book');
    assert.equal(result.source, 'db:polymarket');
    assert.equal(result.rejectionReason, 'last_price_outside_top_of_book');
    assert.equal(result.quoteAtSubmission?.last_price, 0.9);
  }
);

await runTest(
  'derivePredictionDecisionSymbol keeps the market slug from object_id for prediction execution lookups',
  () => {
    const result = derivePredictionDecisionSymbol({
      object_id:
        'pm:will-the-fed-increase-interest-rates-by-25-bps-after-the-june-2026-meeting:YES',
      event_id: 'fed-decision-in-june-825',
      outcome_name: 'Yes',
    });

    assert.equal(
      result,
      'will-the-fed-increase-interest-rates-by-25-bps-after-the-june-2026-meeting'
    );
  }
);

await runTest(
  'buildTradableObjects does not mark market_details-only prediction outcomes as decision-allowed',
  () => {
    const objects = buildTradableObjects(
      {
        objectId: 'pm:new-coronavirus-pandemic-in-2026',
        requestedObjectId: 'pm:new-coronavirus-pandemic-in-2026',
        market: 'prediction',
        symbol: 'new-coronavirus-pandemic-in-2026',
        eventId: 'new-coronavirus-pandemic-in-2026',
        outcomeKey: null,
        requestedScope: 'event',
        predictionLookupKind: 'canonical_event',
        predictionSearchQuery: null,
        predictionTokenId: null,
      },
      null,
      {
        symbol: 'new-coronavirus-pandemic-in-2026',
        name: 'New Coronavirus Pandemic in 2026?',
        title: 'New Coronavirus Pandemic in 2026?',
        description: null,
        event_title: null,
        category: null,
        active: true,
        closed: false,
        archived: false,
        accepting_orders: true,
        market_status: 'active',
        resolves_at: null,
        resolved_outcome_id: null,
        rules: null,
        resolution_source: null,
        volume_24h: null,
        liquidity: null,
        outcomes: [
          {
            id: 'yes_token',
            name: 'Yes',
            price: 0.1065,
          },
        ],
        condition_id: null,
        clob_token_ids: ['yes_token'],
        quote: null,
      },
      {
        status: 'running',
        pausedByOperator: false,
        riskTag: null,
        totalEquity: 10000,
        availableCash: 5000,
        canOpenNewPositions: true,
        positions: [],
      },
      new Map()
    );

    assert.equal(objects?.[0]?.quote?.source, 'market_details');
    assert.equal(objects?.[0]?.tradable, false);
    assert.equal(objects?.[0]?.decision_allowed, false);
    assert.equal(objects?.[0]?.blocked_reason, 'QUOTE_UNAVAILABLE');
  }
);

await runTest(
  'buildPredictionOutcomeQuoteContext prefers live exact outcome quotes before market_details fallback',
  async () => {
    const originalGetQuote = polymarketAdapter.getQuote;
    polymarketAdapter.getQuote = async () => ({
      market: 'prediction',
      provider: 'polymarket',
      symbol: 'new-coronavirus-pandemic-in-2026',
      lastPrice: 0.1065,
      bid: 0.1055,
      ask: 0.1075,
      midpoint: 0.1065,
      spread: 0.002,
      bidSize: null,
      askSize: null,
      volume24h: null,
      change24h: null,
      timestamp: new Date().toISOString(),
      outcomeId: 'yes_token',
      outcomeName: 'Yes',
    });

    try {
      const context = await buildPredictionOutcomeQuoteContext(
        [
          {
            objectId: 'pm:new-coronavirus-pandemic-in-2026',
            requestedObjectId: 'pm:new-coronavirus-pandemic-in-2026',
            market: 'prediction',
            symbol: 'new-coronavirus-pandemic-in-2026',
            eventId: 'new-coronavirus-pandemic-in-2026',
            outcomeKey: null,
            requestedScope: 'event',
            predictionLookupKind: 'canonical_event',
            predictionSearchQuery: null,
            predictionTokenId: null,
          },
        ],
        new Map([
          [
            'pm:new-coronavirus-pandemic-in-2026',
            {
              symbol: 'new-coronavirus-pandemic-in-2026',
              name: 'New Coronavirus Pandemic in 2026?',
              title: 'New Coronavirus Pandemic in 2026?',
              description: null,
              event_title: null,
              category: null,
              active: true,
              closed: false,
              archived: false,
              accepting_orders: true,
              market_status: 'active',
              resolves_at: null,
              resolved_outcome_id: null,
              rules: null,
              resolution_source: null,
              volume_24h: null,
              liquidity: null,
              outcomes: [{ id: 'yes_token', name: 'Yes', price: 0.1065 }],
              condition_id: null,
              clob_token_ids: ['yes_token'],
              quote: null,
            },
          ],
        ]),
        new Map()
      );

      const result = context.get(
        'NEW-CORONAVIRUS-PANDEMIC-IN-2026::YES_TOKEN'
      );
      assert.equal(result?.source, 'live:polymarket');
      assert.equal(result?.quote?.bid, 0.1055);
      assert.equal(result?.quote?.ask, 0.1075);
    } finally {
      polymarketAdapter.getQuote = originalGetQuote;
    }
  }
);

await runTest(
  'buildArenaStatusStripModel computes market, freshness, and risk tones from the current snapshot',
  () => {
    const nowMs = new Date('2026-04-15T14:00:00.000Z').getTime();
    const model = buildArenaStatusStripModel({
      leaderboardSnapshotAt: '2026-04-15T13:55:00.000Z',
      latestTradeAt: '2026-04-15T13:59:00.000Z',
      leaderHeartbeatAt: '2026-04-15T13:35:00.000Z',
      leaderRiskTag: 'high_risk',
      leaderCloseOnly: false,
      nowMs,
    });

    assert.equal(model.session.phase, 'open');
    assert.equal(model.sessionTone, 'green');
    assert.equal(model.leaderboardFreshness.level, 'fresh');
    assert.equal(model.leaderboardTone, 'green');
    assert.equal(model.liveFeedFreshness.level, 'fresh');
    assert.equal(model.liveFeedTone, 'green');
    assert.equal(model.heartbeatFreshness.level, 'delayed');
    assert.equal(model.heartbeatTone, 'amber');
    assert.equal(model.effectiveRiskTag, 'high_risk');
    assert.equal(model.riskTone, 'amber');
  }
);

await runTest(
  'buildArenaStatusStripModel marks unavailable feeds and lets close-only override the risk tag',
  () => {
    const nowMs = new Date('2026-04-18T15:00:00.000Z').getTime();
    const model = buildArenaStatusStripModel({
      leaderboardSnapshotAt: null,
      latestTradeAt: '2026-04-18T14:40:00.000Z',
      leaderHeartbeatAt: '2026-04-18T13:30:00.000Z',
      leaderRiskTag: 'high_risk',
      leaderCloseOnly: true,
      nowMs,
    });

    assert.equal(model.session.phase, 'weekend');
    assert.equal(model.sessionTone, 'neutral');
    assert.equal(model.leaderboardFreshness.level, 'unavailable');
    assert.equal(model.leaderboardTone, 'neutral');
    assert.equal(model.liveFeedFreshness.level, 'stale');
    assert.equal(model.liveFeedTone, 'red');
    assert.equal(model.heartbeatFreshness.level, 'stale');
    assert.equal(model.heartbeatTone, 'red');
    assert.equal(model.effectiveRiskTag, 'close_only');
    assert.equal(model.riskTone, 'red');
  }
);

await runTest(
  'buildDecisionPersistencePlan writes accepted submissions and pending actions with one shared submission id',
  () => {
    const issuedIds: string[] = [];
    let counter = 0;
    const createId = (prefix: 'sub' | 'action' | 'detail') => {
      counter += 1;
      const id = `${prefix}_${counter}`;
      issuedIds.push(id);
      return id;
    };
    const plan = buildDecisionPersistencePlan({
      createId,
      decisionId: 'decision_1',
      agentId: 'agent_1',
      competitionId: 'competition_1',
      decisionRationale: 'This is a sufficiently long rationale for execution.',
      windowId: '2026-04-30T12:00',
      status: 'accepted',
      rejectionReason: null,
      receivedAt: '2026-04-30T12:00:10.000Z',
      actions: [
        {
          action_id: 'action_1',
          side: 'buy',
          market: 'stock',
          symbol: 'AAPL',
          object_id: 'AAPL',
          amount_usd: 100,
          reason_tag: 'momentum',
          reasoning_summary: 'Buy the breakout while risk remains bounded.',
          event_id: null,
          outcome_id: null,
          outcome_name: null,
        },
        {
          action_id: 'action_2',
          side: 'sell',
          market: 'crypto',
          symbol: 'BTCUSD',
          object_id: 'BTCUSD',
          amount_usd: 50,
          reason_tag: 'rebalance',
          reasoning_summary: 'Trim exposure after the recent extension.',
          event_id: null,
          outcome_id: null,
          outcome_name: null,
        },
      ],
    });

    assert.equal(plan.submission.id, 'sub_1');
    assert.equal(plan.submission.status, 'accepted');
    assert.equal(plan.submission.rejection_reason, null);
    assert.equal(plan.submission.fallback_reasoning_summary, 'Buy the breakout while risk remains bounded.');
    assert.equal(plan.submission.reason_tag, 'momentum');
    assert.equal(plan.actions.length, 2);
    assert.equal(plan.actions[0].submission_id, 'sub_1');
    assert.equal(plan.actions[1].submission_id, 'sub_1');
    assert.equal(plan.actions[0].status, 'pending');
    assert.equal(plan.actions[1].status, 'pending');
    assert.equal(plan.actions[0].requested_units, 0);
    assert.deepEqual(issuedIds, ['sub_1', 'action_2', 'action_3']);
  }
);

await runTest(
  'buildDecisionPersistencePlan writes rejected submissions and rejected actions with the shared rejection reason',
  () => {
    let counter = 0;
    const plan = buildDecisionPersistencePlan({
      createId: (prefix: 'sub' | 'action' | 'detail') => {
        counter += 1;
        return `${prefix}_${counter}`;
      },
      decisionId: 'decision_2',
      agentId: 'agent_1',
      competitionId: 'competition_1',
      decisionRationale: 'This decision was rejected after a rules check.',
      windowId: '2026-04-30T12:00',
      status: 'rejected',
      rejectionReason: 'MARKET_CLOSED',
      receivedAt: '2026-04-30T12:01:10.000Z',
      actions: [
        {
          action_id: 'action_1',
          side: 'buy',
          market: 'stock',
          symbol: 'MSFT',
          object_id: 'MSFT',
          amount_usd: 100,
          reason_tag: 'breakout',
          reasoning_summary: 'Attempted entry after a failed market-hours check.',
          event_id: null,
          outcome_id: null,
          outcome_name: null,
        },
      ],
    });

    assert.equal(plan.submission.status, 'rejected');
    assert.equal(plan.submission.rejection_reason, 'MARKET_CLOSED');
    assert.equal(plan.actions[0].status, 'rejected');
    assert.equal(plan.actions[0].rejection_reason, 'MARKET_CLOSED');
    assert.equal(plan.actions[0].order_type, 'market');
  }
);

await runTest(
  'summarizeDecisionExecution maps execution outcomes to submission status and final rejection reason',
  () => {
    assert.deepEqual(
      summarizeDecisionExecution({
        actions: [
          {
            status: 'filled',
            rejection_reason: null,
          },
        ],
      }),
      {
        portfolioChanged: true,
        executionStatus: 'executed',
        submissionStatus: 'accepted',
        rejectionReason: null,
      }
    );

    assert.deepEqual(
      summarizeDecisionExecution({
        actions: [
          {
            status: 'partial',
            rejection_reason: null,
          },
          {
            status: 'rejected',
            rejection_reason: 'INSUFFICIENT_CASH',
          },
        ],
      }),
      {
        portfolioChanged: true,
        executionStatus: 'partial',
        submissionStatus: 'accepted',
        rejectionReason: null,
      }
    );

    assert.deepEqual(
      summarizeDecisionExecution({
        actions: [
          {
            status: 'rejected',
            rejection_reason: 'NO_PRICE_DATA',
          },
        ],
      }),
      {
        portfolioChanged: false,
        executionStatus: 'rejected',
        submissionStatus: 'rejected',
        rejectionReason: 'NO_PRICE_DATA',
      }
    );
  }
);

await runTest(
  'buildDetailRequestPersistenceRow normalizes arrays and response payload for one detail-request row',
  () => {
    const row = buildDetailRequestPersistenceRow({
      createId: (prefix: 'sub' | 'action' | 'detail') => `${prefix}_1`,
      agentId: 'agent_1',
      competitionId: 'competition_1',
      requestId: 'request_1',
      decisionWindowStart: '2026-04-30T12:00:00.000Z',
      briefingWindowId: '2026-04-30T12:00',
      requestReason: 'Need outcome-level confirmation before trading.',
      objectsRequested: ['pm:event:YES', 'pm:event:NO'],
      symbolsRequested: ['EVENT', 'EVENT'],
      responseSummary: '{"summary":{"requested_objects":2}}',
      requestedAt: '2026-04-30T12:00:30.000Z',
    });

    assert.equal(row.id, 'detail_1');
    assert.equal(row.agent_id, 'agent_1');
    assert.equal(row.request_id, 'request_1');
    assert.equal(row.briefing_window_id, '2026-04-30T12:00');
    assert.equal(row.objects_requested, '["pm:event:YES","pm:event:NO"]');
    assert.equal(row.symbols_requested, '["EVENT","EVENT"]');
    assert.equal(row.response_summary, '{"summary":{"requested_objects":2}}');
  }
);

await runTest(
  'buildSeedStore keeps demo data fictional and strips claim/api-key runtime artifacts',
  () => {
    const store = buildSeedStore(new Date('2026-05-01T00:00:00.000Z'));

    assert.deepEqual(
      store.users.map((user: { email: string }) => user.email),
      ['alice@example.test', 'bruno@example.test']
    );
    assert.equal(store.agentApiKeys.length, 0);
    assert.equal(store.agentClaims.length, 0);
  }
);

await runTest(
  'writeDecisionPersistencePlan issues one submission insert and one action insert per action inside a transaction',
  async () => {
    let counter = 0;
    const plan = buildDecisionPersistencePlan({
      createId: (prefix: 'sub' | 'action' | 'detail') => {
        counter += 1;
        return `${prefix}_${counter}`;
      },
      decisionId: 'decision_3',
      agentId: 'agent_2',
      competitionId: 'competition_2',
      decisionRationale: 'Rationale long enough to persist an accepted decision.',
      windowId: '2026-04-30T12:30',
      status: 'accepted',
      rejectionReason: null,
      receivedAt: '2026-04-30T12:30:15.000Z',
      actions: [
        {
          action_id: 'action_a',
          side: 'buy',
          market: 'stock',
          symbol: 'NVDA',
          object_id: 'NVDA',
          amount_usd: 100,
          reason_tag: 'momentum',
          reasoning_summary: 'Follow the trend while keeping size controlled.',
          event_id: null,
          outcome_id: null,
          outcome_name: null,
        },
        {
          action_id: 'action_b',
          side: 'sell',
          market: 'crypto',
          symbol: 'ETHUSD',
          object_id: 'ETHUSD',
          amount_usd: 80,
          reason_tag: 'mean_reversion',
          reasoning_summary: 'Reduce exposure into resistance after an extended rally.',
          event_id: null,
          outcome_id: null,
          outcome_name: null,
        },
      ],
    });
    const recorder = createSqlRecorder();

    await writeDecisionPersistencePlan(recorder.sql, plan);

    assert.equal(recorder.operations.length, 5);
    assert.equal(recorder.operations[0].kind, 'begin');
    assert.match(recorder.operations[1].text, /insert into decision_window_consumptions/i);
    assert.match(recorder.operations[2].text, /insert into decision_submissions/i);
    assert.match(recorder.operations[3].text, /insert into decision_actions/i);
    assert.match(recorder.operations[4].text, /insert into decision_actions/i);
    assert.equal(recorder.operations[1].values[2], 'sub_1');
    assert.equal(recorder.operations[2].values[0], 'sub_1');
    assert.equal(recorder.operations[3].values[1], 'sub_1');
    assert.equal(recorder.operations[3].values[2], 'action_a');
    assert.equal(recorder.operations[4].values[2], 'action_b');
    assert.equal(recorder.operations[3].values[15], 'pending');
    assert.equal(recorder.operations[4].values[15], 'pending');
  }
);

await runTest(
  'updateDecisionSubmissionExecutionResult writes the final status update for one submission row',
  async () => {
    const recorder = createSqlRecorder();

    await updateDecisionSubmissionExecutionResult(recorder.sql, {
      submissionId: 'sub_99',
      status: 'rejected',
      rejectionReason: 'NO_PRICE_DATA',
    });

    assert.equal(recorder.operations.length, 2);
    assert.match(recorder.operations[0].text, /update decision_submissions/i);
    assert.match(recorder.operations[1].text, /update decision_window_consumptions/i);
    assert.deepEqual(recorder.operations[0].values, [
      'rejected',
      'NO_PRICE_DATA',
      'sub_99',
    ]);
    assert.deepEqual(recorder.operations[1].values, [
      'rejected',
      'NO_PRICE_DATA',
      'sub_99',
    ]);
  }
);

await runTest(
  'writeDetailRequestPersistenceRow writes one detail_requests insert with serialized arrays',
  async () => {
    const recorder = createSqlRecorder();
    const row = buildDetailRequestPersistenceRow({
      createId: (prefix: 'sub' | 'action' | 'detail') => `${prefix}_42`,
      agentId: 'agent_42',
      competitionId: 'competition_42',
      requestId: 'request_42',
      decisionWindowStart: '2026-04-30T13:00:00.000Z',
      briefingWindowId: '2026-04-30T13:00',
      requestReason: 'Need market detail before placing a prediction trade.',
      objectsRequested: ['pm:event:yes'],
      symbolsRequested: ['EVENT'],
      responseSummary: '{"summary":{"decision_allowed_objects":1}}',
      requestedAt: '2026-04-30T13:00:20.000Z',
    });

    await writeDetailRequestPersistenceRow(recorder.sql, row);

    assert.equal(recorder.operations.length, 1);
    assert.match(recorder.operations[0].text, /insert into detail_requests/i);
    assert.deepEqual(recorder.operations[0].values, [
      'detail_42',
      'agent_42',
      'competition_42',
      'request_42',
      '2026-04-30T13:00:00.000Z',
      '2026-04-30T13:00',
      'Need market detail before placing a prediction trade.',
      '["pm:event:yes"]',
      '["EVENT"]',
      '{"summary":{"decision_allowed_objects":1}}',
      '2026-04-30T13:00:20.000Z',
    ]);
  }
);

await runTest('handleAgentDecisionPost short-circuits when database mode is unavailable', async () => {
  const unavailable = jsonResponse(
    { code: 'DATABASE_MODE_REQUIRED', message: 'db only' },
    503
  );
  let authCalled = false;
  let submitCalled = false;
  const response = await handleAgentDecisionPost(
    new Request('https://example.com/api/agent/decisions', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    }),
    {
      requireDatabaseModeApi: (featureName: string) => {
        assert.equal(featureName, 'Agent runtime API');
        return unavailable;
      },
      requireClaimedActiveAgent: async () => {
        authCalled = true;
        return { ok: false, response: jsonResponse({ code: 'UNREACHABLE' }, 500) };
      },
      submitDecision: async () => {
        submitCalled = true;
        return { ok: true, data: { ok: true } };
      },
      agentError: agentErrorResponse,
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.equal(response, unavailable);
  assert.equal(authCalled, false);
  assert.equal(submitCalled, false);
});

await runTest('handleAgentDecisionPost returns claimed-agent auth failures directly', async () => {
  const authFailure = jsonResponse({ code: 'AGENT_AUTH_REQUIRED' }, 401);
  let submitCalled = false;
  const request = new Request('https://example.com/api/agent/decisions', {
    method: 'POST',
    body: JSON.stringify({ ok: true }),
  });
  const response = await handleAgentDecisionPost(request, {
    requireDatabaseModeApi: () => null,
    requireClaimedActiveAgent: async (passedRequest: Request) => {
      assert.equal(passedRequest, request);
      return { ok: false, response: authFailure };
    },
    submitDecision: async () => {
      submitCalled = true;
      return { ok: true, data: { ok: true } };
    },
    agentError: agentErrorResponse,
    agentSuccess: agentSuccessResponse,
  });

  assert.equal(response, authFailure);
  assert.equal(submitCalled, false);
});

await runTest('handleAgentDecisionPost passes malformed JSON to submitDecision as null', async () => {
  const response = await handleAgentDecisionPost(
    new Request('https://example.com/api/agent/decisions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    }),
    {
      requireDatabaseModeApi: () => null,
      requireClaimedActiveAgent: async () => ({
        ok: true,
        state: {
          agentId: 'agent_123',
        },
      }),
      submitDecision: async (agentId: string, body: unknown) => {
        assert.equal(agentId, 'agent_123');
        assert.equal(body, null);
        return { ok: true, data: { accepted: true } };
      },
      agentError: agentErrorResponse,
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.deepEqual(await readJson(response), { accepted: true });
});

await runTest('handleAgentDecisionPost forwards object error details to agentError', async () => {
  let capturedDetails: Record<string, unknown> | undefined;
  let capturedStatus: number | undefined;
  const response = await handleAgentDecisionPost(
    new Request('https://example.com/api/agent/decisions', {
      method: 'POST',
      body: JSON.stringify({ action: 'buy' }),
    }),
    {
      requireDatabaseModeApi: () => null,
      requireClaimedActiveAgent: async () => ({
        ok: true,
        state: {
          agentId: 'agent_123',
        },
      }),
      submitDecision: async () => ({
        ok: false,
        code: 'BAD_DECISION',
        message: 'Decision invalid',
        status: 422,
        details: {
          reason: 'stale_quote',
        },
      }),
      agentError: (
        code: string,
        message: string,
        details?: Record<string, unknown>,
        status?: number
      ) => {
        capturedDetails = details;
        capturedStatus = status;
        return jsonResponse({ code, message, details }, status ?? 500);
      },
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.equal(capturedStatus, 422);
  assert.deepEqual(capturedDetails, { reason: 'stale_quote' });
  assert.deepEqual(await readJson(response), {
    code: 'BAD_DECISION',
    message: 'Decision invalid',
    details: {
      reason: 'stale_quote',
    },
  });
});

await runTest('handleAgentDecisionPost drops non-object error details before calling agentError', async () => {
  let capturedDetails: Record<string, unknown> | undefined;
  const response = await handleAgentDecisionPost(
    new Request('https://example.com/api/agent/decisions', {
      method: 'POST',
      body: JSON.stringify({ action: 'buy' }),
    }),
    {
      requireDatabaseModeApi: () => null,
      requireClaimedActiveAgent: async () => ({
        ok: true,
        state: {
          agentId: 'agent_123',
        },
      }),
      submitDecision: async () => ({
        ok: false,
        code: 'BAD_DECISION',
        message: 'Decision invalid',
        status: 422,
        details: 'not-an-object',
      }),
      agentError: (
        code: string,
        message: string,
        details?: Record<string, unknown>,
        status?: number
      ) => {
        capturedDetails = details;
        return jsonResponse({ code, message, details }, status ?? 500);
      },
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.equal(capturedDetails, undefined);
  assert.deepEqual(await readJson(response), {
    code: 'BAD_DECISION',
    message: 'Decision invalid',
  });
});

await runTest('handleAgentDecisionPost returns agentSuccess for accepted decisions', async () => {
  const response = await handleAgentDecisionPost(
    new Request('https://example.com/api/agent/decisions', {
      method: 'POST',
      body: JSON.stringify({ action: 'buy' }),
    }),
    {
      requireDatabaseModeApi: () => null,
      requireClaimedActiveAgent: async () => ({
        ok: true,
        state: {
          agentId: 'agent_123',
        },
      }),
      submitDecision: async (agentId: string, body: unknown) => {
        assert.equal(agentId, 'agent_123');
        assert.deepEqual(body, { action: 'buy' });
        return {
          ok: true,
          data: {
            accepted: true,
            decisionId: 'decision_1',
          },
        };
      },
      agentError: agentErrorResponse,
      agentSuccess: wrappedAgentSuccessResponse,
    }
  );

  assert.deepEqual(await readJson(response), {
    ok: true,
    data: {
      accepted: true,
      decisionId: 'decision_1',
    },
  });
});

await runTest('handleAgentDecisionPost maps unexpected errors to INTERNAL_ERROR', async () => {
  let errorCall: {
    code: string;
    message: string;
    details: Record<string, unknown> | undefined;
    status: number | undefined;
  } | null = null;

  await withSilencedConsoleError(async () => {
    const response = await handleAgentDecisionPost(
      new Request('https://example.com/api/agent/decisions', {
        method: 'POST',
        body: JSON.stringify({ action: 'buy' }),
      }),
      {
        requireDatabaseModeApi: () => null,
        requireClaimedActiveAgent: async () => ({
          ok: true,
          state: {
            agentId: 'agent_123',
          },
        }),
        submitDecision: async () => {
          throw new Error('boom');
        },
        agentError: (
          code: string,
          message: string,
          details?: Record<string, unknown>,
          status?: number
        ) => {
          errorCall = { code, message, details, status };
          return jsonResponse({ code, message }, status ?? 500);
        },
        agentSuccess: agentSuccessResponse,
      }
    );

    assert.deepEqual(await readJson(response), {
      code: 'INTERNAL_ERROR',
      message: 'Decision submission failed',
    });
  });

  assert.deepEqual(errorCall, {
    code: 'INTERNAL_ERROR',
    message: 'Decision submission failed',
    details: undefined,
    status: 500,
  });
});

await runTest('handleAgentDetailRequestPost short-circuits when database mode is unavailable', async () => {
  const unavailable = jsonResponse(
    { code: 'DATABASE_MODE_REQUIRED', message: 'db only' },
    503
  );
  let authCalled = false;
  let submitCalled = false;
  const response = await handleAgentDetailRequestPost(
    new Request('https://example.com/api/agent/detail-request', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    }),
    {
      requireDatabaseModeApi: (featureName: string) => {
        assert.equal(featureName, 'Agent runtime API');
        return unavailable;
      },
      authenticateAgentRequest: async () => {
        authCalled = true;
        return { ok: false, response: jsonResponse({ code: 'UNREACHABLE' }, 500) };
      },
      submitDetailRequest: async () => {
        submitCalled = true;
        return { ok: true, data: { ok: true } };
      },
      agentError: agentErrorResponse,
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.equal(response, unavailable);
  assert.equal(authCalled, false);
  assert.equal(submitCalled, false);
});

await runTest('handleAgentDetailRequestPost returns auth failures directly', async () => {
  const authFailure = jsonResponse({ code: 'AGENT_AUTH_REQUIRED' }, 401);
  let submitCalled = false;
  const request = new Request('https://example.com/api/agent/detail-request', {
    method: 'POST',
    body: JSON.stringify({ ok: true }),
  });
  const response = await handleAgentDetailRequestPost(request, {
    requireDatabaseModeApi: () => null,
    authenticateAgentRequest: async (passedRequest: Request) => {
      assert.equal(passedRequest, request);
      return { ok: false, response: authFailure };
    },
    submitDetailRequest: async () => {
      submitCalled = true;
      return { ok: true, data: { ok: true } };
    },
    agentError: agentErrorResponse,
    agentSuccess: agentSuccessResponse,
  });

  assert.equal(response, authFailure);
  assert.equal(submitCalled, false);
});

await runTest('handleAgentDetailRequestPost passes malformed JSON to submitDetailRequest as null', async () => {
  const response = await handleAgentDetailRequestPost(
    new Request('https://example.com/api/agent/detail-request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    }),
    {
      requireDatabaseModeApi: () => null,
      authenticateAgentRequest: async () => ({
        ok: true,
        agentId: 'agent_123',
      }),
      submitDetailRequest: async (agentId: string, body: unknown) => {
        assert.equal(agentId, 'agent_123');
        assert.equal(body, null);
        return { ok: true, data: { accepted: true } };
      },
      agentError: agentErrorResponse,
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.deepEqual(await readJson(response), { accepted: true });
});

await runTest('handleAgentDetailRequestPost forwards error results through agentError', async () => {
  let capturedDetails: Record<string, unknown> | undefined;
  const response = await handleAgentDetailRequestPost(
    new Request('https://example.com/api/agent/detail-request', {
      method: 'POST',
      body: JSON.stringify({ object_id: 'pm:fed-june-decision' }),
    }),
    {
      requireDatabaseModeApi: () => null,
      authenticateAgentRequest: async () => ({
        ok: true,
        agentId: 'agent_123',
      }),
      submitDetailRequest: async () => ({
        ok: false,
        code: 'DETAIL_BLOCKED',
        message: 'Detail request blocked',
        status: 409,
        details: {
          reason: 'market_closed',
        },
      }),
      agentError: (
        code: string,
        message: string,
        details?: Record<string, unknown>,
        status?: number
      ) => {
        capturedDetails = details;
        return jsonResponse({ code, message, details }, status ?? 500);
      },
      agentSuccess: agentSuccessResponse,
    }
  );

  assert.deepEqual(capturedDetails, { reason: 'market_closed' });
  assert.deepEqual(await readJson(response), {
    code: 'DETAIL_BLOCKED',
    message: 'Detail request blocked',
    details: {
      reason: 'market_closed',
    },
  });
});

await runTest('handleAgentDetailRequestPost returns agentSuccess for accepted detail requests', async () => {
  const response = await handleAgentDetailRequestPost(
    new Request('https://example.com/api/agent/detail-request', {
      method: 'POST',
      body: JSON.stringify({ object_id: 'pm:fed-june-decision' }),
    }),
    {
      requireDatabaseModeApi: () => null,
      authenticateAgentRequest: async () => ({
        ok: true,
        agentId: 'agent_123',
      }),
      submitDetailRequest: async (agentId: string, body: unknown) => {
        assert.equal(agentId, 'agent_123');
        assert.deepEqual(body, { object_id: 'pm:fed-june-decision' });
        return {
          ok: true,
          data: {
            detailRequestId: 'detail_1',
            accepted: true,
          },
        };
      },
      agentError: agentErrorResponse,
      agentSuccess: wrappedAgentSuccessResponse,
    }
  );

  assert.deepEqual(await readJson(response), {
    ok: true,
    data: {
      detailRequestId: 'detail_1',
      accepted: true,
    },
  });
});

await runTest('handleAgentDetailRequestPost maps unexpected errors to INTERNAL_ERROR', async () => {
  let errorCall: {
    code: string;
    message: string;
    details: Record<string, unknown> | undefined;
    status: number | undefined;
  } | null = null;

  await withSilencedConsoleError(async () => {
    const response = await handleAgentDetailRequestPost(
      new Request('https://example.com/api/agent/detail-request', {
        method: 'POST',
        body: JSON.stringify({ object_id: 'pm:fed-june-decision' }),
      }),
      {
        requireDatabaseModeApi: () => null,
        authenticateAgentRequest: async () => ({
          ok: true,
          agentId: 'agent_123',
        }),
        submitDetailRequest: async () => {
          throw new Error('boom');
        },
        agentError: (
          code: string,
          message: string,
          details?: Record<string, unknown>,
          status?: number
        ) => {
          errorCall = { code, message, details, status };
          return jsonResponse({ code, message }, status ?? 500);
        },
        agentSuccess: agentSuccessResponse,
      }
    );

    assert.deepEqual(await readJson(response), {
      code: 'INTERNAL_ERROR',
      message: 'Detail request failed',
    });
  });

  assert.deepEqual(errorCall, {
    code: 'INTERNAL_ERROR',
    message: 'Detail request failed',
    details: undefined,
    status: 500,
  });
});

await runTest('handleCronJobGet rejects unauthorized requests before touching the job', async () => {
  let availabilityChecked = false;
  let runJobCalled = false;
  const unauthorized = jsonResponse({ code: 'UNAUTHORIZED' }, 401);
  const response = await handleCronJobGet(
    new Request('https://example.com/api/cron/market-refresh'),
    {
      verifyCronRequest: () => false,
      requireDatabaseModeCron: () => {
        availabilityChecked = true;
        return null;
      },
      runJob: async () => {
        runJobCalled = true;
        return { ok: true };
      },
      buildUnauthorizedResponse: () => unauthorized,
      buildSuccessResponse: agentSuccessResponse,
      buildFailureResponse: () => jsonResponse({ ok: false }, 500),
      logLabel: 'cron/test',
    }
  );

  assert.equal(response, unauthorized);
  assert.equal(availabilityChecked, false);
  assert.equal(runJobCalled, false);
});

await runTest('handleCronJobGet returns database-mode failures before running the job', async () => {
  let runJobCalled = false;
  const unavailable = jsonResponse({ code: 'DATABASE_MODE_REQUIRED' }, 503);
  const response = await handleCronJobGet(
    new Request('https://example.com/api/cron/market-refresh'),
    {
      verifyCronRequest: () => true,
      requireDatabaseModeCron: () => unavailable,
      runJob: async () => {
        runJobCalled = true;
        return { ok: true };
      },
      buildUnauthorizedResponse: () => jsonResponse({ code: 'UNAUTHORIZED' }, 401),
      buildSuccessResponse: agentSuccessResponse,
      buildFailureResponse: () => jsonResponse({ ok: false }, 500),
      logLabel: 'cron/test',
    }
  );

  assert.equal(response, unavailable);
  assert.equal(runJobCalled, false);
});

await runTest('handleCronJobGet wraps successful job results with the success responder', async () => {
  let successPayload: { ok: boolean; refreshed: number } | null = null;
  const response = await handleCronJobGet(
    new Request('https://example.com/api/cron/market-refresh'),
    {
      verifyCronRequest: () => true,
      requireDatabaseModeCron: () => null,
      runJob: async () => ({
        ok: true,
        refreshed: 3,
      }),
      buildUnauthorizedResponse: () => jsonResponse({ code: 'UNAUTHORIZED' }, 401),
      buildSuccessResponse: (result: { ok: boolean; refreshed: number }) => {
        successPayload = result;
        return jsonResponse({ wrapped: result });
      },
      buildFailureResponse: () => jsonResponse({ ok: false }, 500),
      logLabel: 'cron/test',
    }
  );

  assert.deepEqual(successPayload, {
    ok: true,
    refreshed: 3,
  });
  assert.deepEqual(await readJson(response), {
    wrapped: {
      ok: true,
      refreshed: 3,
    },
  });
});

await runTest('handleCronJobGet maps thrown job errors to the failure responder', async () => {
  let failureBuilt = false;

  await withSilencedConsoleError(async () => {
    const response = await handleCronJobGet(
      new Request('https://example.com/api/cron/market-refresh'),
      {
        verifyCronRequest: () => true,
        requireDatabaseModeCron: () => null,
        runJob: async () => {
          throw new Error('boom');
        },
        buildUnauthorizedResponse: () => jsonResponse({ code: 'UNAUTHORIZED' }, 401),
        buildSuccessResponse: agentSuccessResponse,
        buildFailureResponse: () => {
          failureBuilt = true;
          return jsonResponse({ ok: false, failed: true }, 500);
        },
        logLabel: 'cron/test',
      }
    );

    assert.deepEqual(await readJson(response), {
      ok: false,
      failed: true,
    });
  });

  assert.equal(failureBuilt, true);
});

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
