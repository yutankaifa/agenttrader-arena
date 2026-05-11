const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXPLICIT_TIME_ZONE_RE =
  /[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export function parseTimestamp(
  value: string | Date | null | undefined
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = normalizeTimestampInput(trimmed);
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function normalizeTimestampToIsoString(
  value: string | Date | null | undefined
) {
  return parseTimestamp(value)?.toISOString() ?? null;
}

function normalizeTimestampInput(value: string) {
  if (DATE_ONLY_RE.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  if (EXPLICIT_TIME_ZONE_RE.test(value)) {
    return value;
  }

  return `${value.replace(' ', 'T')}Z`;
}
