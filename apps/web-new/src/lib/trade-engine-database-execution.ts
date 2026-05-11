import { updateAgentAccountState } from '@/lib/agent-account-state';
import { writeLiveTradeEvent, writeRiskEvent } from '@/lib/agent-events';
import { type ActionResult, buildActionResult } from './trade-engine-core';
import {
  markActionExecutedDatabase,
  writeTradeExecutionDatabase,
} from './trade-engine-database-support';

type BuildActionResultInput = Parameters<typeof buildActionResult>[0];

type PersistExecutedActionInput = {
  agentId: string;
  submissionId: string;
  competitionId: string;
  side: 'BUY' | 'SELL';
  action: BuildActionResultInput['action'];
  requestedUnits: number;
  status: BuildActionResultInput['status'];
  filledUnits: BuildActionResultInput['filledUnits'];
  fillPrice: number;
  fee: number;
  notionalUsd: BuildActionResultInput['notionalUsd'];
  topTier: BuildActionResultInput['topTier'];
  quoteSource: BuildActionResultInput['quoteSource'];
  quoteAtSubmission: BuildActionResultInput['quoteAtSubmission'];
  quoteDebug: BuildActionResultInput['quoteDebug'];
  fillableNotionalUsdAtSubmission: BuildActionResultInput['fillableNotionalUsdAtSubmission'];
  slippage: number;
  executionMethod: string | null;
  depthSnapshot: string | null;
  availableCash: number;
  executedAt: Date;
};

export async function persistExecutedActionDatabase(
  input: PersistExecutedActionInput
): Promise<ActionResult> {
  await writeTradeExecutionDatabase({
    actionId: input.action.id,
    requestedUnits: input.requestedUnits,
    filledUnits: input.filledUnits,
    fillPrice: input.fillPrice,
    slippage: input.slippage,
    fee: input.fee,
    quoteSource: input.quoteSource,
    executionMethod: input.executionMethod,
    depthSnapshot: input.depthSnapshot,
    executedAt: input.executedAt,
  });
  await markActionExecutedDatabase(
    input.action.id,
    input.status,
    input.requestedUnits
  );

  const persistedAccountState = await updateAgentAccountState({
    agentId: input.agentId,
    availableCash: input.availableCash,
  });

  await writeRiskEvent({
    agentId: input.agentId,
    competitionId: input.competitionId,
    previousRiskTag: persistedAccountState.previousRiskTag,
    riskTag: persistedAccountState.riskTag,
    cash: input.availableCash,
    equity: persistedAccountState.totalEquity,
  });

  await writeLiveTradeEvent({
    agentId: input.agentId,
    submissionId: input.submissionId,
    actionId: input.action.id,
    competitionId: input.competitionId,
    symbol: input.action.symbol,
    side: input.side,
    notionalUsd: input.notionalUsd,
    positionRatio:
      persistedAccountState.totalEquity > 0
        ? input.notionalUsd / persistedAccountState.totalEquity
        : null,
    outcomeName: input.action.outcomeName,
    reasonTag: input.action.reasonTag,
    displayRationale: input.action.displayRationale,
    executedAt: input.executedAt,
  });

  return buildActionResult({
    action: { ...input.action, status: input.status, rejectionReason: null },
    requestedUnits: input.requestedUnits,
    status: input.status,
    filledUnits: input.filledUnits,
    fillPrice: input.fillPrice,
    fee: input.fee,
    notionalUsd: input.notionalUsd,
    topTier: input.topTier,
    rejectionReason: null,
    unfilledReason:
      input.status === 'partial' ? 'INSUFFICIENT_TOP_OF_BOOK_LIQUIDITY' : null,
    quoteSource: input.quoteSource,
    quoteAtSubmission: input.quoteAtSubmission,
    quoteDebug: input.quoteDebug,
    fillableNotionalUsdAtSubmission: input.fillableNotionalUsdAtSubmission,
    liquidityModel: 'top_of_book_ioc',
    slippage: input.slippage,
    slippageBps: input.slippage * 10_000,
  });
}
