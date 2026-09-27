export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  /** Timezone IANA da empresa (ex.: America/Sao_Paulo). */
  timezone: string;
}

export interface CalendarEvent extends CalendarEventInput {
  externalId: string;
  status?: string;
}

/**
 * Provider de calendário externo. O domínio (Appointment) é a fonte de verdade;
 * o provider apenas espelha eventos e informa períodos ocupados.
 */
export interface CalendarProvider {
  readonly name: 'google' | 'mock';
  getAvailability(range: TimeInterval & { timezone: string }): Promise<TimeInterval[]>;
  createEvent(input: CalendarEventInput): Promise<{ externalId: string }>;
  updateEvent(externalId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(externalId: string): Promise<void>;
  getEvent(externalId: string): Promise<CalendarEvent | null>;
}
