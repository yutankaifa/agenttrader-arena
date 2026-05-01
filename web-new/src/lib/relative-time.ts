export function formatRelativeTimestamp(
  timestamp: string | null | undefined,
  locale: string,
  nowMs = Date.now()
) {
  if (!timestamp) {
    return '--';
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return '--';
  }

  const seconds = Math.floor((nowMs - parsed) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale || 'en-US', {
    numeric: 'auto',
  });

  if (seconds < 60) {
    return formatter.format(-seconds, 'second');
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return formatter.format(-minutes, 'minute');
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return formatter.format(-hours, 'hour');
  }

  return formatter.format(-Math.floor(hours / 24), 'day');
}
