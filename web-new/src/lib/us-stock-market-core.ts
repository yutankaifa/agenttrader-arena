export const US_MARKET_TIME_ZONE = 'America/New_York';

export type UsStockMarketSessionPhase =
  | 'open'
  | 'pre_market'
  | 'after_hours'
  | 'weekend'
  | 'holiday';

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type TimeZoneDateParts = CalendarDate & {
  weekday: number;
  hour: number;
  minute: number;
};

const ET_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: US_MARKET_TIME_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function createUtcCalendarDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function shiftCalendarDate(date: CalendarDate, deltaDays: number) {
  const shifted = createUtcCalendarDate(date.year, date.month, date.day);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isSameCalendarDate(left: CalendarDate, right: CalendarDate) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}

function getTimeZoneDateParts(date = new Date()): TimeZoneDateParts {
  const parts = ET_PARTS_FORMATTER.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekdayLabel = values.get('weekday') ?? 'Sun';

  return {
    year: Number(values.get('year') ?? 0),
    month: Number(values.get('month') ?? 0),
    day: Number(values.get('day') ?? 0),
    weekday: WEEKDAY_INDEX[weekdayLabel] ?? 0,
    hour: Number(values.get('hour') ?? 0),
    minute: Number(values.get('minute') ?? 0),
  };
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number
) {
  const cursor = createUtcCalendarDate(year, month, 1);
  let count = 0;

  while (cursor.getUTCMonth() === month - 1) {
    if (cursor.getUTCDay() === weekday) {
      count += 1;
      if (count === nth) {
        return {
          year,
          month,
          day: cursor.getUTCDate(),
        };
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    year,
    month,
    day: 1,
  };
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const cursor = createUtcCalendarDate(year, month + 1, 0);

  while (cursor.getUTCDay() !== weekday) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return {
    year,
    month,
    day: cursor.getUTCDate(),
  };
}

function getObservedFixedHoliday(year: number, month: number, day: number) {
  const holiday = createUtcCalendarDate(year, month, day);
  const weekday = holiday.getUTCDay();

  if (weekday === 6) {
    holiday.setUTCDate(holiday.getUTCDate() - 1);
  } else if (weekday === 0) {
    holiday.setUTCDate(holiday.getUTCDate() + 1);
  }

  return {
    year: holiday.getUTCFullYear(),
    month: holiday.getUTCMonth() + 1,
    day: holiday.getUTCDate(),
  };
}

function getEasterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return {
    year,
    month,
    day,
  };
}

function getGoodFriday(year: number) {
  return shiftCalendarDate(getEasterDate(year), -2);
}

function isUsStockMarketHoliday(parts: CalendarDate) {
  const holidays: CalendarDate[] = [
    getObservedFixedHoliday(parts.year, 1, 1),
    nthWeekdayOfMonth(parts.year, 1, 1, 3),
    nthWeekdayOfMonth(parts.year, 2, 1, 3),
    getGoodFriday(parts.year),
    lastWeekdayOfMonth(parts.year, 5, 1),
    getObservedFixedHoliday(parts.year, 6, 19),
    getObservedFixedHoliday(parts.year, 7, 4),
    nthWeekdayOfMonth(parts.year, 9, 1, 1),
    nthWeekdayOfMonth(parts.year, 11, 4, 4),
    getObservedFixedHoliday(parts.year, 12, 25),
    getObservedFixedHoliday(parts.year + 1, 1, 1),
  ];

  return holidays.some((holiday) => isSameCalendarDate(parts, holiday));
}

function isUsStockMarketEarlyClose(parts: CalendarDate & { weekday: number }) {
  if (parts.weekday === 0 || parts.weekday === 6) {
    return false;
  }

  if (isUsStockMarketHoliday(parts)) {
    return false;
  }

  const thanksgiving = nthWeekdayOfMonth(parts.year, 11, 4, 4);
  if (isSameCalendarDate(parts, shiftCalendarDate(thanksgiving, 1))) {
    return true;
  }

  if (parts.month === 12 && parts.day === 24) {
    return true;
  }

  if (parts.month === 7 && parts.day === 3) {
    return true;
  }

  const independenceDay = createUtcCalendarDate(parts.year, 7, 4).getUTCDay();
  if (independenceDay === 0 && parts.month === 7 && parts.day === 2) {
    return true;
  }

  return false;
}

export function getUsStockMarketSession(date = new Date()) {
  const parts = getTimeZoneDateParts(date);
  const minutes = parts.hour * 60 + parts.minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = isUsStockMarketEarlyClose(parts) ? 13 * 60 : 16 * 60;

  if (parts.weekday === 0 || parts.weekday === 6) {
    return {
      phase: 'weekend' as const,
      isOpen: false,
      isEarlyClose: false,
      minutesUntilOpen: null,
      minutesUntilClose: null,
    };
  }

  if (isUsStockMarketHoliday(parts)) {
    return {
      phase: 'holiday' as const,
      isOpen: false,
      isEarlyClose: false,
      minutesUntilOpen: null,
      minutesUntilClose: null,
    };
  }

  if (minutes < openMinutes) {
    return {
      phase: 'pre_market' as const,
      isOpen: false,
      isEarlyClose: closeMinutes === 13 * 60,
      minutesUntilOpen: openMinutes - minutes,
      minutesUntilClose: null,
    };
  }

  if (minutes >= closeMinutes) {
    return {
      phase: 'after_hours' as const,
      isOpen: false,
      isEarlyClose: closeMinutes === 13 * 60,
      minutesUntilOpen: null,
      minutesUntilClose: null,
    };
  }

  return {
    phase: 'open' as const,
    isOpen: true,
    isEarlyClose: closeMinutes === 13 * 60,
    minutesUntilOpen: 0,
    minutesUntilClose: closeMinutes - minutes,
  };
}

export function isUsStockMarketOpen(date = new Date()) {
  return getUsStockMarketSession(date).isOpen;
}
