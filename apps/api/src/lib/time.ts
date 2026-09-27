import { TZDate } from '@date-fns/tz';
import { startOfDay, startOfMonth, subDays } from 'date-fns';

export type UsagePeriod = 'today' | '7d' | '30d' | 'month';

export const USAGE_PERIODS: UsagePeriod[] = ['today', '7d', '30d', 'month'];

/** Início do período no fuso da empresa (retorna instante UTC). */
export function periodStart(period: UsagePeriod, timezone: string, now: Date = new Date()): Date {
  const local = new TZDate(now.getTime(), timezone);
  switch (period) {
    case 'today':
      return new Date(startOfDay(local).getTime());
    case '7d':
      return new Date(startOfDay(subDays(local, 6)).getTime());
    case '30d':
      return new Date(startOfDay(subDays(local, 29)).getTime());
    case 'month':
      return new Date(startOfMonth(local).getTime());
  }
}

export function monthStart(timezone: string, now: Date = new Date()): Date {
  return periodStart('month', timezone, now);
}
