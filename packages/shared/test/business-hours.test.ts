import { describe, expect, it } from 'vitest';
import {
  businessDaySchema,
  getLocalDateParts,
  getOpeningIntervals,
  isOpenAt,
  weeklyScheduleSchema,
  type WeeklySchedule,
} from '../src/business-hours';

const monday: WeeklySchedule = [{ weekday: 1, open: '09:00', close: '17:00', breaks: [] }];

describe('validação de expediente e pausas', () => {
  it.each([
    { start: '08:00', end: '10:00' },
    { start: '16:00', end: '18:00' },
    { start: '18:00', end: '19:00' },
    { start: '13:00', end: '12:00' },
    { start: '12:00', end: '12:00' },
  ])('recusa pausa fora do expediente ou sem duração: $start–$end', (pause) => {
    expect(
      businessDaySchema.safeParse({ weekday: 1, open: '09:00', close: '17:00', breaks: [pause] })
        .success,
    ).toBe(false);
  });

  it('permite pausas nas bordas e múltiplos expedientes no mesmo dia', () => {
    expect(
      weeklyScheduleSchema.safeParse([
        { weekday: 1, open: '09:00', close: '12:00', breaks: [{ start: '09:00', end: '10:00' }] },
        { weekday: 1, open: '14:00', close: '17:00', breaks: [{ start: '16:00', end: '17:00' }] },
      ]).success,
    ).toBe(true);
  });

  it('recusa expediente invertido ou horário inválido', () => {
    expect(businessDaySchema.safeParse({ weekday: 1, open: '17:00', close: '09:00' }).success).toBe(
      false,
    );
    expect(businessDaySchema.safeParse({ weekday: 1, open: '09:00', close: '24:00' }).success).toBe(
      false,
    );
  });
});

describe('intervalos disponíveis', () => {
  it('não estende o fechamento com pausa antiga fora do expediente', () => {
    const schedule = [{ ...monday[0]!, breaks: [{ start: '18:00', end: '19:00' }] }];
    expect(getOpeningIntervals(schedule, [], '2026-09-21', 1)).toEqual([{ start: 540, end: 1020 }]);
    expect(isOpenAt(schedule, [], new Date('2026-09-21T17:30:00Z'), 'UTC')).toBe(false);
  });

  it('limita pausas antigas que atravessam abertura e fechamento', () => {
    const schedule = [
      {
        ...monday[0]!,
        breaks: [
          { start: '07:00', end: '10:00' },
          { start: '16:00', end: '19:00' },
        ],
      },
    ];
    expect(getOpeningIntervals(schedule, [], '2026-09-21', 1)).toEqual([{ start: 600, end: 960 }]);
  });

  it('ignora pausa antiga invertida sem criar intervalos sobrepostos', () => {
    const schedule = [{ ...monday[0]!, breaks: [{ start: '13:00', end: '12:00' }] }];
    expect(getOpeningIntervals(schedule, [], '2026-09-21', 1)).toEqual([{ start: 540, end: 1020 }]);
  });

  it('une pausas sobrepostas fora de ordem sem duplicar intervalos', () => {
    const schedule = [
      {
        ...monday[0]!,
        breaks: [
          { start: '13:00', end: '14:00' },
          { start: '12:00', end: '13:30' },
        ],
      },
    ];
    expect(getOpeningIntervals(schedule, [], '2026-09-21', 1)).toEqual([
      { start: 540, end: 720 },
      { start: 840, end: 1020 },
    ]);
  });

  it('uma pausa que cobre todo o expediente não deixa disponibilidade', () => {
    const schedule = [{ ...monday[0]!, breaks: [{ start: '09:00', end: '17:00' }] }];
    expect(getOpeningIntervals(schedule, [], '2026-09-21', 1)).toEqual([]);
  });

  it('feriado fechado prevalece sobre expediente semanal', () => {
    expect(
      getOpeningIntervals(
        monday,
        [{ date: '2026-09-21', name: 'Feriado', closed: true }],
        '2026-09-21',
        1,
      ),
    ).toEqual([]);
  });

  it('horário especial de feriado substitui o expediente e suas pausas', () => {
    expect(
      getOpeningIntervals(
        monday,
        [{ date: '2026-09-21', name: 'Especial', closed: false, open: '10:00', close: '12:00' }],
        '2026-09-21',
        1,
      ),
    ).toEqual([{ start: 600, end: 720 }]);
  });

  it('dia sem expediente fica fechado', () => {
    expect(getOpeningIntervals(monday, [], '2026-09-22', 2)).toEqual([]);
  });
});

describe('horário no fuso da empresa', () => {
  it.each([
    ['2026-09-21T11:59:00Z', false],
    ['2026-09-21T12:00:00Z', true],
    ['2026-09-21T15:00:00Z', false],
    ['2026-09-21T16:00:00Z', true],
    ['2026-09-21T20:00:00Z', false],
  ])('respeita bordas de abertura, pausa e fechamento em %s', (instant, open) => {
    const schedule = [{ ...monday[0]!, breaks: [{ start: '12:00', end: '13:00' }] }];
    expect(isOpenAt(schedule, [], new Date(instant), 'America/Sao_Paulo')).toBe(open);
  });

  it('usa a data e o dia da semana locais na virada de dia UTC', () => {
    expect(getLocalDateParts(new Date('2026-09-21T02:30:00Z'), 'America/Sao_Paulo')).toEqual({
      date: '2026-09-20',
      weekday: 0,
      minutes: 1410,
    });
    expect(isOpenAt(monday, [], new Date('2026-09-21T02:30:00Z'), 'America/Sao_Paulo')).toBe(false);
  });

  it('considera a mudança de offset durante horário de verão', () => {
    expect(getLocalDateParts(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toMatchObject({
      date: '2026-03-08',
      minutes: 119,
    });
    expect(getLocalDateParts(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toMatchObject({
      date: '2026-03-08',
      minutes: 180,
    });
  });

  it('distingue horário não configurado de dia fechado', () => {
    expect(isOpenAt([], [], new Date('2026-09-21T12:00:00Z'), 'UTC')).toBeNull();
    expect(isOpenAt(monday, [], new Date('2026-09-22T12:00:00Z'), 'UTC')).toBe(false);
  });
});
