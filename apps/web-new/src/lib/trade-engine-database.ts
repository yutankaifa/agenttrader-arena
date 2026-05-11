import {
  reduceAgentPosition,
  upsertAgentPosition,
} from '@/lib/agent-account-state';
import { getLatestRankSnapshot } from '@/lib/agent-events';
import { checkPredictionPositionUniqueness } from '@/lib/risk-checks';
import { TRADING_FEE_RATE } from '@/lib/trading-rules';
import { roundUsd } from '@/lib/utils';
import {
  type ActionResult,
  executionStatus,
  makeRejectedResult,
  normalizeExecutionFailureReason,
  normalizeUnfilledReason,
  roundQty,
  topTierFromRank,
  walkBook,
} from './trade-engine-core';
import { persistExecutedActionDatabase } from './trade-engine-database-execution';
import {
  getAgentAccountCashDatabase,
  getExecutionQuoteDatabase,
  getPositionUnitsDatabase,
  listSubmissionActionsDatabase,
  rejectActionDatabase,
  resolveOutcomeNameDatabase,
  updateRequestedUnitsDatabase,
} from './trade-engine-database-support';

export async function executeActionsDatabase(
  agentId: string,
  submissionId: string,
  competitionId: string,
  executedAt = new Date()
) {
  const [actionRows, rankSnapshot] = await Promise.all([
    listSubmissionActionsDatabase(submissionId),
    getLatestRankSnapshot(agentId),
  ]);

  const currentTopTier = topTierFromRank(rankSnapshot);
  const results: ActionResult[] = [];
  let rejectRemainingReason: string | null = null;

  for (const action of actionRows) {
    await resolveOutcomeNameDatabase(action);

    if (rejectRemainingReason) {
      await rejectActionDatabase(action.id, rejectRemainingReason);
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

    try {
      const quoteContext = await getExecutionQuoteDatabase(action, executedAt);
      const executionPrice = quoteContext.price;

      if (quoteContext.rejectionReason) {
        await rejectActionDatabase(action.id, quoteContext.rejectionReason);
        results.push(
          makeRejectedResult({
            action,
            requestedUnits: null,
            topTier: currentTopTier,
            rejectionReason: quoteContext.rejectionReason,
            quoteSource: quoteContext.source,
            quoteAtSubmission: quoteContext.quoteAtSubmission,
            quoteDebug: quoteContext.quoteDebug,
          })
        );
        continue;
      }

      if (!quoteContext.found || !executionPrice) {
        const rejectionReason = `no_price_data: no live market data available for ${action.symbol} (${action.market})`;
        await rejectActionDatabase(action.id, rejectionReason);
        results.push(
          makeRejectedResult({
            action,
            requestedUnits: null,
            topTier: currentTopTier,
            rejectionReason,
            quoteSource: quoteContext.source,
            quoteAtSubmission: quoteContext.quoteAtSubmission,
            quoteDebug: quoteContext.quoteDebug,
          })
        );
        continue;
      }

      const requestedUnits = action.amountUsd / executionPrice;
      await updateRequestedUnitsDatabase(action.id, requestedUnits);
      action.requestedUnits = requestedUnits;

      if (action.market === 'prediction' && action.side === 'buy') {
        const predictionConflict = await checkPredictionPositionUniqueness(agentId, {
          symbol: action.symbol,
          side: action.side,
          market: action.market,
          event_id: action.eventId ?? action.symbol,
          outcome_id: action.outcomeId ?? action.objectId,
        });
        if (predictionConflict) {
          await rejectActionDatabase(action.id, 'prediction_position_conflict');
          rejectRemainingReason = 'prediction_position_conflict';
          results.push(
            makeRejectedResult({
              action,
              requestedUnits,
              topTier: currentTopTier,
              rejectionReason: 'prediction_position_conflict',
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

      const accountCashState = await getAgentAccountCashDatabase(agentId);
      if (!accountCashState.found) {
        await rejectActionDatabase(action.id, 'no_account');
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
      const availableCashBeforeTrade = accountCashState.availableCash ?? 0;

      let filledUnits = 0;
      let rejectionReason: string | null = null;
      let positionUnitsBeforeTrade = 0;

      if (action.side === 'buy') {
        filledUnits = depthFilledUnits;
        if (filledUnits <= 0) {
          rejectionReason = `no_fillable_liquidity: no fillable liquidity for ${action.symbol}`;
        } else {
          const cost = filledUnits * fillPrice;
          const fee = cost * TRADING_FEE_RATE;
          const totalCost = cost + fee;
          if (totalCost > availableCashBeforeTrade) {
            rejectionReason = `insufficient_funds: need $${totalCost.toFixed(2)}, have $${availableCashBeforeTrade.toFixed(2)}`;
          }
        }
      } else {
        positionUnitsBeforeTrade = await getPositionUnitsDatabase(agentId, action);
        if (positionUnitsBeforeTrade <= 0) {
          rejectionReason = `no_position: no holdings for ${action.symbol}`;
        } else if (depthFilledUnits <= 0) {
          rejectionReason = `no_fillable_liquidity: no fillable liquidity for ${action.symbol}`;
        } else {
          filledUnits = Math.min(requestedUnits, positionUnitsBeforeTrade, depthFilledUnits);
        }
      }

      filledUnits = roundQty(filledUnits);
      if (!rejectionReason && filledUnits <= 0) {
        rejectionReason = `no_fillable_liquidity: no fillable liquidity for ${action.symbol}`;
      }

      if (rejectionReason) {
        await rejectActionDatabase(action.id, rejectionReason);
        results.push(
          makeRejectedResult({
            action,
            requestedUnits,
            topTier: currentTopTier,
            rejectionReason,
            quoteSource: quoteContext.source,
            quoteAtSubmission: quoteContext.quoteAtSubmission,
            quoteDebug: quoteContext.quoteDebug,
            fillableNotionalUsdAtSubmission:
              normalizeUnfilledReason(rejectionReason) ===
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

      if (action.side === 'buy') {
        const availableCash = roundUsd(availableCashBeforeTrade - notional - fee);
        await upsertAgentPosition({
          agentId,
          symbol: action.symbol,
          market: action.market,
          eventId: action.eventId,
          outcomeId: action.outcomeId,
          outcomeName: action.outcomeName,
          addUnits: filledUnits,
          price: fillPrice,
        });
        results.push(
          await persistExecutedActionDatabase({
            agentId,
            submissionId,
            competitionId,
            side: 'BUY',
            action,
            requestedUnits,
            status,
            filledUnits,
            fillPrice,
            fee,
            notionalUsd: notional,
            topTier: currentTopTier,
            quoteSource: quoteContext.source,
            quoteAtSubmission: quoteContext.quoteAtSubmission,
            quoteDebug: quoteContext.quoteDebug,
            fillableNotionalUsdAtSubmission: roundUsd(bookFill.fillableNotional),
            slippage,
            executionMethod: quoteContext.method,
            depthSnapshot: quoteContext.depthSnapshot,
            availableCash,
            executedAt,
          })
        );
        continue;
      }

      const availableCash = roundUsd(availableCashBeforeTrade + notional - fee);
      await reduceAgentPosition({
        agentId,
        symbol: action.symbol,
        market: action.market,
        eventId: action.eventId,
        outcomeId: action.outcomeId,
        reduceUnits: filledUnits,
        price: fillPrice,
      });
      results.push(
        await persistExecutedActionDatabase({
          agentId,
          submissionId,
          competitionId,
          side: 'SELL',
          action,
          requestedUnits,
          status,
          filledUnits,
          fillPrice,
          fee,
          notionalUsd: notional,
          topTier: currentTopTier,
          quoteSource: quoteContext.source,
          quoteAtSubmission: quoteContext.quoteAtSubmission,
          quoteDebug: quoteContext.quoteDebug,
          fillableNotionalUsdAtSubmission: roundUsd(
            Math.min(requestedUnits, positionUnitsBeforeTrade, depthFilledUnits) * fillPrice
          ),
          slippage,
          executionMethod: quoteContext.method,
          depthSnapshot: quoteContext.depthSnapshot,
          availableCash,
          executedAt,
        })
      );
    } catch (error) {
      const rejectionReason = normalizeExecutionFailureReason(error);
      await rejectActionDatabase(action.id, rejectionReason);
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

  return results;
}
