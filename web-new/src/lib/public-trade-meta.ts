import type { SiteMessages } from '@/messages';

type SiteTranslate = <T>(selector: (messages: SiteMessages) => T) => T;

export function formatExecutionPathLabel(
  executionPath: string | null | undefined,
  t: SiteTranslate
) {
  if (!executionPath) {
    return t((m) => m.tradeMeta.methodUnavailable);
  }

  if (executionPath === 'sim.market') {
    return t((m) => m.tradeMeta.methodSimMarket);
  }

  if (executionPath === 'book.walk') {
    return t((m) => m.tradeMeta.methodWalkBook);
  }

  if (executionPath === 'fallback') {
    return t((m) => m.tradeMeta.pathFallback);
  }

  if (executionPath.startsWith('db.snapshot')) {
    return withProviderLabel(
      t((m) => m.tradeMeta.pathDbSnapshot),
      executionPath.split('.')[2] ?? null
    );
  }

  if (executionPath.startsWith('db.recent')) {
    return withProviderLabel(
      t((m) => m.tradeMeta.pathDbRecent),
      executionPath.split('.')[2] ?? null
    );
  }

  if (executionPath.startsWith('redis')) {
    return withProviderLabel(
      t((m) => m.tradeMeta.pathRedis),
      executionPath.split('.')[1] ?? null
    );
  }

  if (executionPath.startsWith('live')) {
    return withProviderLabel(
      t((m) => m.tradeMeta.pathLive),
      executionPath.split('.')[1] ?? null
    );
  }

  return executionPath.replace(/[._-]+/g, ' ').trim();
}

export function formatRiskStateLabel(
  riskTag: string | null | undefined,
  closeOnly: boolean | null | undefined,
  t: SiteTranslate
) {
  const effectiveRiskTag = closeOnly ? 'close_only' : riskTag ?? null;

  if (effectiveRiskTag === 'terminated') {
    return t((m) => m.tradeMeta.riskTerminated);
  }

  if (effectiveRiskTag === 'close_only') {
    return t((m) => m.tradeMeta.riskCloseOnly);
  }

  if (effectiveRiskTag === 'high_risk') {
    return t((m) => m.tradeMeta.riskHigh);
  }

  return t((m) => m.tradeMeta.riskNormal);
}

export function getRiskStateTone(
  riskTag: string | null | undefined,
  closeOnly: boolean | null | undefined
) {
  const effectiveRiskTag = closeOnly ? 'close_only' : riskTag ?? null;

  if (effectiveRiskTag === 'terminated' || effectiveRiskTag === 'close_only') {
    return 'red' as const;
  }

  if (effectiveRiskTag === 'high_risk') {
    return 'amber' as const;
  }

  return 'green' as const;
}

function withProviderLabel(label: string, provider: string | null) {
  if (!provider) {
    return label;
  }

  return `${label} (${formatProviderLabel(provider)})`;
}

function formatProviderLabel(provider: string) {
  if (provider === 'massive') {
    return 'Massive';
  }

  if (provider === 'binance') {
    return 'Binance';
  }

  if (provider === 'polymarket') {
    return 'Polymarket';
  }

  return provider
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
