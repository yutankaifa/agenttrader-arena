import { createId } from '@/db/id';
import { updateStore } from '@/db/store';
import type {
  AgentAccount,
  AgentTraderStore,
  DecisionAction,
  MarketDataSnapshot,
} from '@/db/schema';
import { getRiskTagForAccount } from '@/lib/account-metrics';
import type { MarketQuote } from '@/lib/market-adapter/types';
import { getQuote as getRedisQuote, isRedisConfigured } from '@/lib/redis';
import { checkPredictionPositionUniqueness } from '@/lib/risk-checks';
import { TRADING_FEE_RATE } from '@/lib/trading-rules';
import { roundUsd } from '@/lib/utils';
import {
  resolveExecutionQuote,
  type ExecutionMarketQuoteLike,
  type ExecutionQuote,
  type ExecutionSnapshotLike,
} from './execution-quote-resolver';
import {
  type ActionResult,
  buildActionResult,
  executionStatus,
  getLiveQuote,
  makeRejectedResult,
  normalizeExecutionFailureReason,
  normalizeUnfilledReason,
  resolveOutcomeNameWithMarketData,
  roundQty,
  roundRate,
  topTierFromRank,
  walkBook,
} from './trade-engine-core';

function matchesActionSnapshot(
  item: Pick<MarketDataSnapshot, 'symbol' | 'market' | 'outcomeId'>,
  action: DecisionAction
) {
  return (
    item.symbol.toUpperCase() === action.symbol.toUpperCase() &&
    item.market === action.market &&
    (item.outcomeId ?? null) === (action.outcomeId ?? null)
  );
}

function findQuoteAtOrBefore(
  store: AgentTraderStore,
  action: DecisionAction,
  executedAtIso: string
): ExecutionSnapshotLike | null {
  return (
    store.marketDataSnapshots
      .filter(
        (item) =>
          matchesActionSnapshot(item, action) &&
          item.quoteTs.localeCompare(executedAtIso) <= 0
      )
      .sort((a, b) => b.quoteTs.localeCompare(a.quoteTs))
      .map(normalizeExecutionSnapshot)[0] ?? null
  );
}

function findLatestQuote(
  store: AgentTraderStore,
  action: DecisionAction
): ExecutionSnapshotLike | null {
  return (
    store.marketDataSnapshots
      .filter((item) => matchesActionSnapshot(item, action))
      .sort((a, b) => b.quoteTs.localeCompare(a.quoteTs))
      .map(normalizeExecutionSnapshot)[0] ?? null
  );
}

function normalizeExecutionSnapshot(
  item: MarketDataSnapshot
): ExecutionSnapshotLike {
  return {
    provider: item.provider,
    quoteTs: item.quoteTs,
    lastPrice: item.lastPrice,
    bid: item.bid,
    ask: item.ask,
    midpoint: item.midpoint,
    spread: item.spread,
    bidSize: item.bidSize,
    askSize: item.askSize,
    depthSnapshot: item.depthSnapshot ?? null,
  };
}

function normalizeExecutionMarketQuote(
  quote: MarketQuote | null
): ExecutionMarketQuoteLike | null {
  if (!quote) {
    return null;
  }

  return {
    provider: quote.provider,
    timestamp: quote.timestamp,
    lastPrice: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
    midpoint: quote.midpoint,
    spread: quote.spread,
    bidSize: quote.bidSize,
    askSize: quote.askSize,
    depthSnapshot: quote.depthSnapshot ?? null,
  };
}

function findPosition(
  store: AgentTraderStore,
  action: DecisionAction,
  agentId: string
) {
  return (
    store.positions.find(
      (item) =>
        item.agentId === agentId &&
        item.symbol.toUpperCase() === action.symbol.toUpperCase() &&
        item.market === action.market &&
        (item.outcomeId ?? null) === (action.outcomeId ?? null)
    ) ?? null
  );
}

function markAccount(
  store: AgentTraderStore,
  account: AgentAccount,
  agentId: string
) {
  const positions = store.positions.filter((item) => item.agentId === agentId);
  const equity = positions.reduce((sum, position) => {
    const quote =
      store.marketDataSnapshots
        .filter(
          (item) =>
            item.symbol.toUpperCase() === position.symbol.toUpperCase() &&
            item.market === position.market &&
            (item.outcomeId ?? null) === (position.outcomeId ?? null)
        )
        .sort((a, b) => b.quoteTs.localeCompare(a.quoteTs))[0] ?? null;
    const marketPrice = quote?.lastPrice ?? position.marketPrice ?? position.entryPrice;
    position.marketPrice = marketPrice;
    return sum + position.positionSize * marketPrice;
  }, account.availableCash);

  account.totalEquity = roundUsd(equity);
  account.displayEquity = account.totalEquity;
  account.riskTag = getRiskTagForAccount(account.availableCash, account.totalEquity);
  account.updatedAt = new Date().toISOString();
}

async function resolveOutcomeName(
  store: AgentTraderStore,
  action: DecisionAction
) {
  const matchedOutcome = await resolveOutcomeNameWithMarketData(action);
  if (!matchedOutcome) {
    return action.outcomeName;
  }

  action.outcomeName = matchedOutcome;
  const persisted = store.decisionActions.find((item) => item.id === action.id);
  if (persisted) {
    persisted.outcomeName = matchedOutcome;
  }

  return matchedOutcome;
}

async function getExecutionQuote(
  store: AgentTraderStore,
  action: DecisionAction,
  executedAt: Date
): Promise<ExecutionQuote> {
  const instrumentId =
    action.market === 'prediction' && action.outcomeId
      ? `${action.symbol}::${action.outcomeId}`
      : action.symbol;
  const redisConfigured = isRedisConfigured();

  return resolveExecutionQuote({
    instrumentId,
    action,
    executedAt,
    redisConfigured,
    getDbBeforeSubmission: async () =>
      findQuoteAtOrBefore(store, action, executedAt.toISOString()),
    getDbLatest: async () => findLatestQuote(store, action),
    getRedisQuote: redisConfigured
      ? async () =>
          normalizeExecutionMarketQuote(
            await getRedisQuote(
              action.symbol,
              action.market,
              action.market === 'prediction' ? action.outcomeId ?? null : null
            )
          )
      : undefined,
    getLiveQuote: async () => normalizeExecutionMarketQuote(await getLiveQuote(action)),
  });
}

function captureActionExecutionState(
  store: AgentTraderStore,
  account: AgentAccount,
  action: DecisionAction
) {
  return {
    actionStatus: action.status,
    actionRejectionReason: action.rejectionReason,
    account: { ...account },
    positions: store.positions.map((item) => ({ ...item })),
    tradeExecutionsLength: store.tradeExecutions.length,
    liveTradeEventsLength: store.liveTradeEvents.length,
  };
}

function restoreActionExecutionState(
  store: AgentTraderStore,
  account: AgentAccount,
  action: DecisionAction,
  snapshot: ReturnType<typeof captureActionExecutionState>
) {
  Object.assign(account, snapshot.account);
  action.status = snapshot.actionStatus;
  action.rejectionReason = snapshot.actionRejectionReason;
  store.positions = snapshot.positions;
  store.tradeExecutions = store.tradeExecutions.slice(
    0,
    snapshot.tradeExecutionsLength
  );
  store.liveTradeEvents = store.liveTradeEvents.slice(
    0,
    snapshot.liveTradeEventsLength
  );
}

export async function executeActionsFromStore(
  agentId: string,
  submissionId: string,
  competitionId: string,
  executedAt = new Date()
) {
  return await updateStore(async (store) => {
    const actions = store.decisionActions.filter(
      (item) => item.submissionId === submissionId
    );
    const account = store.agentAccounts.find((item) => item.agentId === agentId);
    const latestRanks = store.leaderboardSnapshots
      .slice()
      .sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt));
    const rankRow = latestRanks.find((item) => item.agentId === agentId) ?? null;
    const currentTopTier = topTierFromRank(rankRow?.rank ?? null);
    const results: ActionResult[] = [];
    let rejectRemainingReason: string | null = null;

    for (const action of actions) {
      await resolveOutcomeName(store, action);

      if (rejectRemainingReason) {
        action.status = 'rejected';
        action.rejectionReason = rejectRemainingReason;
        results.push(
          makeRejectedResult({
            action,
            requestedUnits: null,
            topTier: currentTopTier,
            rejectionReason: rejectRemainingReason,
          })
        );
        continue;
      }

      const actionState = account
        ? captureActionExecutionState(store, account, action)
        : null;

      try {
        const quoteContext = await getExecutionQuote(store, action, executedAt);
        const executionPrice = quoteContext.price;

        if (quoteContext.rejectionReason) {
          action.status = 'rejected';
          action.rejectionReason = quoteContext.rejectionReason;
          results.push(
            makeRejectedResult({
              action,
              requestedUnits: null,
              topTier: currentTopTier,
              rejectionReason: action.rejectionReason,
              quoteSource: quoteContext.source,
              quoteAtSubmission: quoteContext.quoteAtSubmission,
              quoteDebug: quoteContext.quoteDebug,
            })
          );
          continue;
        }

        if (!quoteContext.found || !executionPrice) {
          action.status = 'rejected';
          action.rejectionReason = `no_price_data: no live market data available for ${action.symbol} (${action.market})`;
          results.push(
            makeRejectedResult({
              action,
              requestedUnits: null,
              topTier: currentTopTier,
              rejectionReason: action.rejectionReason,
              quoteSource: quoteContext.source,
              quoteAtSubmission: quoteContext.quoteAtSubmission,
              quoteDebug: quoteContext.quoteDebug,
            })
          );
          continue;
        }

        const requestedUnits = action.amountUsd / executionPrice;
        action.requestedUnits = requestedUnits;

        if (!account) {
          action.status = 'rejected';
          action.rejectionReason = 'no_account';
          results.push(
            makeRejectedResult({
              action,
              requestedUnits,
              topTier: currentTopTier,
              rejectionReason: 'no_account',
              quoteAtSubmission: quoteContext.quoteAtSubmission,
            })
          );
          continue;
        }

        if (action.market === 'prediction' && action.side === 'buy') {
          const predictionConflict = await checkPredictionPositionUniqueness(agentId, {
            symbol: action.symbol,
            side: action.side,
            market: action.market,
            event_id: action.eventId ?? action.symbol,
            outcome_id: action.outcomeId ?? action.objectId,
          });
          if (predictionConflict) {
            action.status = 'rejected';
            action.rejectionReason = 'prediction_position_conflict';
            rejectRemainingReason = 'prediction_position_conflict';
            results.push(
              makeRejectedResult({
                action,
                requestedUnits,
                topTier: currentTopTier,
                rejectionReason: action.rejectionReason,
                quoteSource: quoteContext.source,
                quoteAtSubmission: quoteContext.quoteAtSubmission,
                quoteDebug: quoteContext.quoteDebug,
              })
            );
            continue;
          }
        }
        const bookFill = walkBook({
          requestedUnits,
          side: action.side,
          quotePrice: executionPrice,
          depthSnapshot: quoteContext.depthSnapshot,
        });
        const depthFilledUnits = roundQty(bookFill.filledUnits);
        const fillPrice = bookFill.fillPrice;
        const slippage = bookFill.slippage;
        const position = findPosition(store, action, agentId);
        const positionUnitsBeforeTrade = position?.positionSize ?? 0;

        let filledUnits = 0;
        let rejectionReason: string | null = null;

        if (action.side === 'buy') {
          filledUnits = depthFilledUnits;
          if (filledUnits <= 0) {
            rejectionReason = `no_fillable_liquidity: no fillable liquidity for ${action.symbol}`;
          } else {
            const cost = filledUnits * fillPrice;
            const fee = cost * TRADING_FEE_RATE;
            const totalCost = cost + fee;
            if (totalCost > account.availableCash) {
              rejectionReason = `insufficient_funds: need $${totalCost.toFixed(2)}, have $${account.availableCash.toFixed(2)}`;
            }
          }
        } else {
          const currentUnits = position?.positionSize ?? 0;
          if (currentUnits <= 0) {
            rejectionReason = `no_position: no holdings for ${action.symbol}`;
          } else if (depthFilledUnits <= 0) {
            rejectionReason = `no_fillable_liquidity: no fillable liquidity for ${action.symbol}`;
          } else {
            filledUnits = Math.min(requestedUnits, currentUnits, depthFilledUnits);
          }
        }

        filledUnits = roundQty(filledUnits);
        if (!rejectionReason && filledUnits <= 0) {
          rejectionReason = `no_fillable_liquidity: no fillable liquidity for ${action.symbol}`;
        }

        if (rejectionReason) {
          action.status = 'rejected';
          action.rejectionReason = rejectionReason;
          results.push(
            makeRejectedResult({
              action,
              requestedUnits,
              topTier: currentTopTier,
              rejectionReason: action.rejectionReason,
              quoteSource: quoteContext.source,
              quoteAtSubmission: quoteContext.quoteAtSubmission,
              quoteDebug: quoteContext.quoteDebug,
              fillableNotionalUsdAtSubmission:
                normalizeUnfilledReason(action.rejectionReason) ===
                'INSUFFICIENT_TOP_OF_BOOK_LIQUIDITY'
                  ? 0
                  : null,
            })
          );
          continue;
        }

        const notional = roundUsd(filledUnits * fillPrice);
        const fee = roundUsd(notional * TRADING_FEE_RATE);
        const status = executionStatus(action, filledUnits, requestedUnits);

        action.status = status;
        action.rejectionReason = null;

        if (action.side === 'buy') {
          account.availableCash = roundUsd(account.availableCash - notional - fee);
          if (position) {
            const nextUnits = position.positionSize + filledUnits;
            position.entryPrice = roundUsd(
              (position.positionSize * position.entryPrice + filledUnits * fillPrice) /
                nextUnits
            );
            position.positionSize = roundQty(nextUnits);
            position.marketPrice = fillPrice;
            position.updatedAt = executedAt.toISOString();
          } else {
            store.positions.push({
              id: createId('pos'),
              agentId,
              symbol: action.symbol,
              market: action.market,
              eventId: action.eventId,
              outcomeId: action.outcomeId,
              outcomeName: action.outcomeName,
              positionSize: filledUnits,
              entryPrice: fillPrice,
              marketPrice: fillPrice,
              updatedAt: executedAt.toISOString(),
            });
          }
        } else if (position) {
          account.availableCash = roundUsd(account.availableCash + notional - fee);
          position.positionSize = roundQty(position.positionSize - filledUnits);
          position.marketPrice = fillPrice;
          position.updatedAt = executedAt.toISOString();
          if (position.positionSize <= 0.000001) {
            store.positions = store.positions.filter((item) => item.id !== position.id);
          }
        }

        markAccount(store, account, agentId);

        store.tradeExecutions.push({
          id: createId('exec'),
          actionId: action.id,
          requestedUnits,
          filledUnits,
          fillPrice,
          slippage: roundRate(slippage) ?? 0,
          fee,
          quoteSource: quoteContext.source,
          executionMethod: quoteContext.method,
          depthSnapshot: quoteContext.depthSnapshot,
          executedAt: executedAt.toISOString(),
        });

        store.liveTradeEvents.push({
          id: createId('live'),
          competitionId,
          agentId,
          submissionId,
          actionId: action.id,
          rankSnapshot: rankRow?.rank ?? null,
          symbol: action.symbol,
          side: action.side,
          notionalUsd: notional,
          positionRatio: account.totalEquity > 0 ? notional / account.totalEquity : null,
          outcomeName: action.outcomeName,
          reasonTag: action.reasonTag,
          displayRationale: action.displayRationale,
          executedAt: executedAt.toISOString(),
        });

        results.push(
          buildActionResult({
            action,
            requestedUnits,
            status,
            filledUnits,
            fillPrice,
            fee,
            notionalUsd: notional,
            topTier: currentTopTier,
            rejectionReason: null,
            unfilledReason:
              status === 'partial' ? 'INSUFFICIENT_TOP_OF_BOOK_LIQUIDITY' : null,
            quoteSource: quoteContext.source,
            quoteAtSubmission: quoteContext.quoteAtSubmission,
            quoteDebug: quoteContext.quoteDebug,
            fillableNotionalUsdAtSubmission:
              action.side === 'sell'
                ? roundUsd(
                    Math.min(requestedUnits, positionUnitsBeforeTrade, depthFilledUnits) *
                      fillPrice
                  )
                : roundUsd(bookFill.fillableNotional),
            liquidityModel: 'top_of_book_ioc',
            slippage,
            slippageBps: slippage * 10_000,
          })
        );
      } catch (error) {
        if (account && actionState) {
          restoreActionExecutionState(store, account, action, actionState);
        }
        const rejectionReason = normalizeExecutionFailureReason(error);
        action.status = 'rejected';
        action.rejectionReason = rejectionReason;
        results.push(
          makeRejectedResult({
            action,
            requestedUnits: null,
            topTier: currentTopTier,
            rejectionReason,
          })
        );
      }
    }

    if (account) {
      markAccount(store, account, agentId);
    }
    return results;
  });
}
