import { IntegrationError } from '@botsaas/shared';
import { z } from 'zod';
import type { CalendarEvent, CalendarEventInput, CalendarProvider, TimeInterval } from './types';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const freeBusyResponseSchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })),
      errors: z.array(z.unknown()).max(0).optional(),
    }),
  ),
});

/** Escopos mínimos: criar/editar eventos e consultar livre/ocupado. */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
}

export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * O Google não aceita mais a autorização salva: refresh token revogado pelo usuário,
 * senha alterada, inatividade ou app OAuth em modo "Testing" (tokens expiram em 7 dias).
 * Nenhum retry resolve; só uma nova conexão pelo painel.
 */
export class GoogleReauthorizationRequiredError extends IntegrationError {
  constructor() {
    super('A autorização do Google Agenda expirou ou foi revogada — reconecte a agenda.', {
      retryable: false,
    });
    this.name = 'GoogleReauthorizationRequiredError';
  }
}

async function tokenRequest(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<GoogleTokens> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (body.grant_type === 'refresh_token' && json.error === 'invalid_grant') {
    throw new GoogleReauthorizationRequiredError();
  }
  if (!response.ok || !json.access_token) {
    throw new IntegrationError(`Falha no OAuth do Google (${json.error ?? response.status}).`, {
      retryable: response.status >= 500,
    });
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    },
    fetchImpl,
  );
}

export interface GoogleCalendarProviderOptions {
  oauth: GoogleOAuthConfig;
  tokens: GoogleTokens;
  calendarId?: string;
  /** Chamado quando o token é renovado, para persistir (criptografado) no banco. */
  onTokensRefreshed?: (tokens: GoogleTokens) => Promise<void>;
  /** Chamado antes de lançar `GoogleReauthorizationRequiredError`, para sinalizar a integração. */
  onReauthorizationRequired?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}

interface GoogleEventBody {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google' as const;
  private tokens: GoogleTokens;
  private readonly calendarId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleCalendarProviderOptions) {
    this.tokens = options.tokens;
    this.calendarId = options.calendarId ?? 'primary';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.tokens.expiresAt - 60_000 > Date.now()) return this.tokens.accessToken;
    let refreshed: GoogleTokens;
    try {
      if (!this.tokens.refreshToken) throw new GoogleReauthorizationRequiredError();
      refreshed = await tokenRequest(
        {
          refresh_token: this.tokens.refreshToken,
          client_id: this.options.oauth.clientId,
          client_secret: this.options.oauth.clientSecret,
          grant_type: 'refresh_token',
        },
        this.fetchImpl,
      );
    } catch (error) {
      if (error instanceof GoogleReauthorizationRequiredError)
        await this.options.onReauthorizationRequired?.();
      throw error;
    }
    this.tokens = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? this.tokens.refreshToken,
    };
    await this.options.onTokensRefreshed?.(this.tokens);
    return this.tokens.accessToken;
  }

  private async call<T>(
    path: string,
    init: RequestInit = {},
    options: { allowNotFound?: boolean } = {},
  ): Promise<T | null> {
    const response = await this.fetchImpl(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404 && options.allowNotFound) return null;
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new IntegrationError(`Google Calendar respondeu ${response.status}.`, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return (await response.json()) as T;
  }

  private eventPath(externalId?: string): string {
    const base = `/calendars/${encodeURIComponent(this.calendarId)}/events`;
    return externalId ? `${base}/${encodeURIComponent(externalId)}` : base;
  }

  private toBody(input: CalendarEventInput) {
    return {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    };
  }

  async getAvailability(range: TimeInterval & { timezone: string }): Promise<TimeInterval[]> {
    const body = await this.call<unknown>('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: range.start.toISOString(),
        timeMax: range.end.toISOString(),
        timeZone: range.timezone,
        items: [{ id: this.calendarId }],
      }),
    });
    const parsed = freeBusyResponseSchema.safeParse(body);
    const calendar = parsed.success ? parsed.data.calendars[this.calendarId] : undefined;
    // Resposta incompleta ou com erro nunca significa que a agenda está livre.
    if (!calendar) {
      throw new IntegrationError('Google Calendar não retornou disponibilidade válida.');
    }
    const intervals = calendar.busy.map((interval) => ({
      start: new Date(interval.start),
      end: new Date(interval.end),
    }));
    if (
      intervals.some(
        ({ start, end }) =>
          !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end,
      )
    ) {
      throw new IntegrationError('Google Calendar retornou intervalo de ocupação inválido.');
    }
    return intervals;
  }

  async createEvent(input: CalendarEventInput): Promise<{ externalId: string }> {
    const body = await this.call<GoogleEventBody>(this.eventPath(), {
      method: 'POST',
      body: JSON.stringify(this.toBody(input)),
    });
    if (!body?.id) throw new IntegrationError('Google Calendar não retornou o ID do evento.');
    return { externalId: body.id };
  }

  async updateEvent(externalId: string, input: CalendarEventInput): Promise<void> {
    await this.call(this.eventPath(externalId), {
      method: 'PATCH',
      body: JSON.stringify(this.toBody(input)),
    });
  }

  async deleteEvent(externalId: string): Promise<void> {
    await this.call(this.eventPath(externalId), { method: 'DELETE' }, { allowNotFound: true });
  }

  async getEvent(externalId: string): Promise<CalendarEvent | null> {
    const body = await this.call<GoogleEventBody>(
      this.eventPath(externalId),
      {},
      { allowNotFound: true },
    );
    if (!body?.start?.dateTime || !body.end?.dateTime) return null;
    return {
      externalId: body.id,
      title: body.summary ?? '',
      description: body.description,
      start: new Date(body.start.dateTime),
      end: new Date(body.end.dateTime),
      timezone: body.start.timeZone ?? 'UTC',
      status: body.status,
    };
  }
}
