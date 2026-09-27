import { TZDate } from '@date-fns/tz';
import { addDays, addMinutes } from 'date-fns';
import { getOpeningIntervals, type HolidayLike, type WeeklySchedule } from '@botsaas/shared';

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** YYYY-MM-DD no fuso da empresa */
  fromDate: string;
  days: number;
  durationMinutes: number;
  timezone: string;
  schedule: WeeklySchedule;
  holidays: HolidayLike[];
  busy: Interval[];
  now: Date;
  /** Antecedência mínima para agendar */
  minNoticeMinutes?: number;
  stepMinutes?: number;
  maxSlots?: number;
}

/** Converte data local (YYYY-MM-DD) + minutos do dia no fuso da empresa para instante UTC. */
export function localDateTimeToUtc(localDate: string, minutes: number, timezone: string): Date {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const local = new TZDate(
    year,
    month - 1,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    timezone,
  );
  return new Date(local.getTime());
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function nextLocalDate(
  localDate: string,
  offset: number,
  timezone: string,
): { date: string; weekday: number } {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const base = new TZDate(year, month - 1, day, 12, 0, 0, timezone);
  const next = addDays(base, offset);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, weekday: next.getDay() };
}

/**
 * Horários livres respeitando expediente, pausas, feriados, compromissos existentes e
 * antecedência mínima. Todos os cálculos de dia/hora são feitos no fuso da empresa.
 */
export function computeAvailableSlots(query: SlotQuery): Interval[] {
  const step = query.stepMinutes ?? Math.min(30, query.durationMinutes);
  const earliest = addMinutes(query.now, query.minNoticeMinutes ?? 60);
  const slots: Interval[] = [];
  for (let offset = 0; offset < query.days; offset += 1) {
    const { date, weekday } = nextLocalDate(query.fromDate, offset, query.timezone);
    for (const opening of getOpeningIntervals(query.schedule, query.holidays, date, weekday)) {
      for (let start = opening.start; start + query.durationMinutes <= opening.end; start += step) {
        const slot = {
          start: localDateTimeToUtc(date, start, query.timezone),
          end: localDateTimeToUtc(date, start + query.durationMinutes, query.timezone),
        };
        if (slot.start < earliest) continue;
        if (query.busy.some((busy) => overlaps(slot, busy))) continue;
        slots.push(slot);
        if (query.maxSlots && slots.length >= query.maxSlots) return slots;
      }
    }
  }
  return slots;
}

export function formatSlot(slot: Interval, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(slot.start);
}
