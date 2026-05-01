function normalizePolymarketSlug(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function extractPolymarketEventSlug(input: string) {
  const match = input.trim().match(
    /^https?:\/\/(?:www\.)?polymarket\.com\/event\/([^/?#]+)(?:[/?#].*)?$/i
  );
  return match?.[1] ? normalizePolymarketSlug(decodeURIComponent(match[1])) : null;
}

function extractPolymarketMarketSlug(input: string) {
  const match = input.trim().match(
    /^https?:\/\/(?:www\.)?polymarket\.com\/market\/([^/?#]+)(?:[/?#].*)?$/i
  );
  return match?.[1] ? normalizePolymarketSlug(decodeURIComponent(match[1])) : null;
}

export function buildPredictionSearchQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const eventSlugFromUrl = extractPolymarketEventSlug(trimmed);
  if (eventSlugFromUrl) {
    return eventSlugFromUrl;
  }

  const marketSlugFromUrl = extractPolymarketMarketSlug(trimmed);
  if (marketSlugFromUrl) {
    return marketSlugFromUrl;
  }

  if (trimmed.startsWith('pm_search:')) {
    const searchQuery = trimmed.slice('pm_search:'.length).trim();
    return searchQuery || null;
  }

  if (trimmed.startsWith('pm_event:')) {
    const eventId = trimmed.slice('pm_event:'.length).trim();
    return eventId || null;
  }

  if (trimmed.startsWith('pm:')) {
    const withoutPrefix = trimmed.slice(3).trim();
    if (!withoutPrefix) {
      return null;
    }

    const eventId = withoutPrefix.split(':').shift()?.trim() ?? '';
    return eventId || null;
  }

  return trimmed;
}

export function buildPredictionSearchFallbackSuggestions(query: string) {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }

  return [
    normalized,
    `${normalized} prediction`,
    `${normalized} polymarket`,
  ].filter((value, index, items) => items.indexOf(value) === index);
}
