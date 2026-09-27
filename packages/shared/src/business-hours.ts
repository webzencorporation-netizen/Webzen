import { z } from 'zod';

/** Horário semanal no fuso da empresa. weekday: 0 = domingo ... 6 = sábado. */
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const businessDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    open: timeString,
    close: timeString,
    breaks: z
      .array(z.object({ start: timeString, end: timeString }))
      .max(4)
      .default([]),
  })
  .refine((day) => day.open < day.close, { message: 'Abertura deve ser antes do fechamento' });

export const weeklyScheduleSchema = z.array(businessDaySchema).max(14);

export type BusinessDay = z.infer<typeof businessDaySchema>;
export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

export interface HolidayLike {
  date: string;
  name: string;
  closed: boolean;
  open?: string | null;
  close?: string | null;
}

export const WEEKDAY_NAMES = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export interface LocalDateParts {
  /** YYYY-MM-DD no fuso informado */
  date: string;
  weekday: number;
  /** minutos desde 00:00 no fuso informado */
  minutes: number;
}

export function toMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: weekdays.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Intervalos de atendimento (em minutos locais) de um dia específico, considerando feriados. */
export function getOpeningIntervals(
  schedule: WeeklySchedule,
  holidays: HolidayLike[],
  localDate: string,
  weekday: number,
): { start: number; end: number }[] {
  const holiday = holidays.find((item) => item.date === localDate);
  if (holiday?.closed) return [];
  if (holiday && holiday.open && holiday.close) {
    return [{ start: toMinutes(holiday.open), end: toMinutes(holiday.close) }];
  }
  const intervals: { start: number; end: number }[] = [];
  for (const day of schedule.filter((item) => item.weekday === weekday)) {
    const breaks = [...(day.breaks ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    let cursor = toMinutes(day.open);
    for (const pause of breaks) {
      const pauseStart = toMinutes(pause.start);
      if (pauseStart > cursor) intervals.push({ start: cursor, end: pauseStart });
      cursor = Math.max(cursor, toMinutes(pause.end));
    }
    const close = toMinutes(day.close);
    if (close > cursor) intervals.push({ start: cursor, end: close });
  }
  return intervals;
}

export function isOpenAt(
  schedule: WeeklySchedule | null | undefined,
  holidays: HolidayLike[],
  at: Date,
  timeZone: string,
): boolean | null {
  if (!schedule || schedule.length === 0) return null;
  const local = getLocalDateParts(at, timeZone);
  return getOpeningIntervals(schedule, holidays, local.date, local.weekday).some(
    (interval) => local.minutes >= interval.start && local.minutes < interval.end,
  );
}

/** Texto legível do horário semanal (usado no prompt e no painel). */
export function formatWeeklySchedule(schedule: WeeklySchedule | null | undefined): string {
  if (!schedule || schedule.length === 0) return '';
  const lines: string[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const index = weekday % 7;
    const days = schedule.filter((day) => day.weekday === index);
    if (days.length === 0) {
      lines.push(`  ${WEEKDAY_NAMES[index]}: fechado`);
      continue;
    }
    const text = days
      .map((day) => {
        const breaks = (day.breaks ?? [])
          .map((pause) => ` (pausa ${pause.start}–${pause.end})`)
          .join('');
        return `${day.open}–${day.close}${breaks}`;
      })
      .join(', ');
    lines.push(`  ${WEEKDAY_NAMES[index]}: ${text}`);
  }
  return lines.join('\n');
}
