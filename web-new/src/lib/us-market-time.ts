import { US_MARKET_TIME_ZONE } from './us-stock-market-core';
import { parseTimestamp } from './timestamp';

type DateTimeStyle = 'time' | 'dateTime' | 'chart';

export function formatUsMarketDateTime(
  value: string | null | undefined,
  locale: string,
  style: DateTimeStyle = 'dateTime'
) {
  if (!value) return '--';

  const date = parseTimestamp(value);
  if (!date) {
    return '--';
  }

  const options: Intl.DateTimeFormatOptions =
    style === 'time'
      ? {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: US_MARKET_TIME_ZONE,
          timeZoneName: 'short',
        }
      : style === 'chart'
        ? {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: US_MARKET_TIME_ZONE,
          }
        : {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: US_MARKET_TIME_ZONE,
            timeZoneName: 'short',
          };

  return new Intl.DateTimeFormat(locale || 'en-US', options).format(date);
}
