import { randomUUID } from 'node:crypto';
import type { CalendarEvent, CalendarEventInput, CalendarProvider, TimeInterval } from './types';

/** Calendário em memória — testes e desenvolvimento sem credenciais Google. */
export class MockCalendarProvider implements CalendarProvider {
  readonly name = 'mock' as const;
  readonly events = new Map<string, CalendarEvent>();
  /** Períodos ocupados adicionais (simulam compromissos externos). */
  busy: TimeInterval[] = [];

  async getAvailability(range: TimeInterval): Promise<TimeInterval[]> {
    const eventIntervals = [...this.events.values()].map(({ start, end }) => ({ start, end }));
    return [...this.busy, ...eventIntervals].filter(
      (interval) => interval.start < range.end && interval.end > range.start,
    );
  }

  async createEvent(input: CalendarEventInput): Promise<{ externalId: string }> {
    const externalId = `mock-event-${randomUUID()}`;
    this.events.set(externalId, { ...input, externalId, status: 'confirmed' });
    return { externalId };
  }

  async updateEvent(externalId: string, input: CalendarEventInput): Promise<void> {
    if (!this.events.has(externalId)) throw new Error('Evento não encontrado');
    this.events.set(externalId, { ...input, externalId, status: 'confirmed' });
  }

  async deleteEvent(externalId: string): Promise<void> {
    this.events.delete(externalId);
  }

  async getEvent(externalId: string): Promise<CalendarEvent | null> {
    return this.events.get(externalId) ?? null;
  }
}
