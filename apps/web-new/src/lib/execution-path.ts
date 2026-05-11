function normalizeToken(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || null;
}

function parseQuoteSource(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const channel = normalizeToken(value.slice(0, separatorIndex));
  const provider = normalizeToken(value.slice(separatorIndex + 1));

  if (channel !== 'db' && channel !== 'redis' && channel !== 'live') {
    return null;
  }

  return {
    channel,
    provider,
  };
}

function joinPath(parts: Array<string | null>) {
  return parts.filter(Boolean).join('.');
}

export function buildExecutionPath(
  quoteSource: string | null | undefined,
  executionMethod: string | null | undefined
) {
  const normalizedMethod = normalizeToken(executionMethod);
  const normalizedSource = normalizeToken(quoteSource);
  const parsedSource = parseQuoteSource(quoteSource);

  if (normalizedMethod === 'sim_market' || normalizedSource === 'sim_market') {
    return 'sim.market';
  }

  if (parsedSource?.channel === 'db') {
    if (normalizedMethod === 'walk_book') {
      return joinPath(['db', 'snapshot', parsedSource.provider]);
    }

    if (normalizedMethod === 'db_recent_quote') {
      return joinPath(['db', 'recent', parsedSource.provider]);
    }

    return joinPath(['db', parsedSource.provider, normalizedMethod]);
  }

  if (parsedSource?.channel === 'redis') {
    return joinPath([
      'redis',
      parsedSource.provider,
      normalizedMethod === 'redis_quote' ? null : normalizedMethod,
    ]);
  }

  if (parsedSource?.channel === 'live') {
    return joinPath([
      'live',
      parsedSource.provider,
      normalizedMethod === 'live_quote' ? null : normalizedMethod,
    ]);
  }

  if (normalizedMethod === 'walk_book') {
    return 'book.walk';
  }

  if (normalizedMethod === 'db_recent_quote') {
    return 'db.recent';
  }

  if (normalizedMethod === 'redis_quote') {
    return 'redis';
  }

  if (normalizedMethod === 'live_quote') {
    return 'live';
  }

  if (normalizedMethod === 'fallback') {
    return 'fallback';
  }

  if (normalizedSource) {
    return normalizedSource.replace(/_+/g, '.');
  }

  return normalizedMethod;
}
