import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  GoogleCalendarProvider,
  GoogleReauthorizationRequiredError,
  GOOGLE_CALENDAR_SCOPES,
} from '../src/calendar/google';
import { MockCalendarProvider } from '../src/calendar/mock';

const oauth = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  redirectUri: 'https://app.invalid/callback',
};
const now = Date.parse('2026-01-15T12:00:00Z');
const event = {
  title: 'Consulta',
  description: 'Descrição',
  start: new Date('2026-01-16T12:00:00Z'),
  end: new Date('2026-01-16T13:00:00Z'),
  timezone: 'America/Sao_Paulo',
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Rede real proibida neste teste');
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function google(fetchImpl: typeof fetch, calendarId = 'primary') {
  return new GoogleCalendarProvider({
    oauth,
    calendarId,
    tokens: { accessToken: 'fixture-access', expiresAt: now + 3_600_000 },
    fetchImpl,
  });
}

describe('OAuth Google sem rede', () => {
  it('preserva state e callback sem publicar o client secret na URL de autorização', () => {
    const url = new URL(buildGoogleAuthUrl(oauth, 'state+=/&fixture'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBe('state+=/&fixture');
    expect(url.searchParams.get('redirect_uri')).toBe(oauth.redirectUri);
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_CALENDAR_SCOPES);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.href).not.toContain(oauth.clientSecret);
  });

  it('troca código codificado e calcula expiração a partir de expires_in', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 120 }),
      );
    await expect(exchangeGoogleCode(oauth, 'code+/=&', fetchImpl)).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: now + 120_000,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    const body = init?.body as URLSearchParams;
    expect(body.get('code')).toBe('code+/=&');
    expect(body.get('client_secret')).toBe(oauth.clientSecret);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(oauth.redirectUri);
  });

  it.each([
    [400, false],
    [503, true],
  ])('classifica falha OAuth HTTP %i', async (status, retryable) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status }));
    await expect(exchangeGoogleCode(oauth, 'fixture-code', fetchImpl)).rejects.toMatchObject({
      code: 'INTEGRATION_ERROR',
      retryable,
    });
  });

  it('recusa sucesso OAuth sem access_token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ expires_in: 3600 }));
    await expect(exchangeGoogleCode(oauth, 'fixture-code', fetchImpl)).rejects.toMatchObject({
      code: 'INTEGRATION_ERROR',
    });
  });

  it('renova na margem de 60 segundos, preserva refresh token e persiste antes de usar', async () => {
    let persisted = false;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'renewed', expires_in: 3600 }))
      .mockImplementation(async (_url, init) => {
        expect(persisted).toBe(true);
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer renewed' });
        return new Response(null, { status: 404 });
      });
    const onTokensRefreshed = vi.fn(async () => {
      persisted = true;
    });
    const provider = new GoogleCalendarProvider({
      oauth,
      fetchImpl,
      onTokensRefreshed,
      tokens: {
        accessToken: 'expiring',
        refreshToken: 'existing-refresh',
        expiresAt: now + 60_000,
      },
    });
    await provider.deleteEvent('missing');
    await provider.deleteEvent('missing-again');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const body = fetchImpl.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('existing-refresh');
    expect(onTokensRefreshed).toHaveBeenCalledExactlyOnceWith({
      accessToken: 'renewed',
      refreshToken: 'existing-refresh',
      expiresAt: now + 3_600_000,
    });
  });

  it('token expirado sem refresh token exige reconexão sem fazer request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const onReauthorizationRequired = vi.fn(async () => {});
    const provider = new GoogleCalendarProvider({
      oauth,
      fetchImpl,
      onReauthorizationRequired,
      tokens: { accessToken: 'expired', expiresAt: now },
    });
    const failure = await provider.getEvent('event').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect((failure as Error).message).toMatch('reconecte');
    expect(onReauthorizationRequired).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refresh token revogado ou expirado (invalid_grant) exige reconexão e avisa uma vez', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
          { status: 400 },
        ),
      );
    const onReauthorizationRequired = vi.fn(async () => {});
    const onTokensRefreshed = vi.fn(async () => {});
    const provider = new GoogleCalendarProvider({
      oauth,
      fetchImpl,
      onReauthorizationRequired,
      onTokensRefreshed,
      tokens: { accessToken: 'expired', refreshToken: 'revoked', expiresAt: now },
    });

    const failure = await provider
      .getAvailability({
        start: new Date('2026-01-16T00:00:00Z'),
        end: new Date('2026-01-17T00:00:00Z'),
        timezone: 'America/Sao_Paulo',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect((failure as GoogleReauthorizationRequiredError).retryable).toBe(false);
    expect((failure as Error).message).toMatch(/reconecte/i);
    expect(onReauthorizationRequired).toHaveBeenCalledOnce();
    expect(onTokensRefreshed).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('falha temporária do endpoint de token continua repetível, sem pedir reconexão', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'internal_failure' }, { status: 503 }));
    const onReauthorizationRequired = vi.fn(async () => {});
    const provider = new GoogleCalendarProvider({
      oauth,
      fetchImpl,
      onReauthorizationRequired,
      tokens: { accessToken: 'expired', refreshToken: 'valid', expiresAt: now },
    });
    const failure = await provider.getEvent('event').catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect((failure as { retryable: boolean }).retryable).toBe(true);
    expect(onReauthorizationRequired).not.toHaveBeenCalled();
  });
});

describe('Google Calendar com fetch injetado', () => {
  it('consulta ocupação com a agenda e fuso corretos e aceita lista vazia explícita', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          calendars: {
            primary: { busy: [{ start: event.start.toISOString(), end: event.end.toISOString() }] },
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ calendars: { primary: { busy: [] } } }));
    const provider = google(fetchImpl);
    await expect(provider.getAvailability(event)).resolves.toEqual([
      { start: event.start, end: event.end },
    ]);
    await expect(provider.getAvailability(event)).resolves.toEqual([]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
    expect(JSON.parse(init?.body as string)).toEqual({
      timeMin: event.start.toISOString(),
      timeMax: event.end.toISOString(),
      timeZone: event.timezone,
      items: [{ id: 'primary' }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // Token ainda válido: nenhuma renovação.
  });

  it.each([
    {},
    { calendars: {} },
    { calendars: { primary: { errors: [{ reason: 'notFound' }] } } },
    { calendars: { primary: { busy: [], errors: [{ reason: 'internalError' }] } } },
    { calendars: { primary: { busy: [{ start: 'invalid', end: 'invalid' }] } } },
    {
      calendars: {
        primary: { busy: [{ start: event.end.toISOString(), end: event.start.toISOString() }] },
      },
    },
  ])(
    'não converte resposta de disponibilidade incompleta ou inválida em agenda livre: %j',
    async (body) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
      await expect(google(fetchImpl).getAvailability(event)).rejects.toMatchObject({
        code: 'INTEGRATION_ERROR',
      });
    },
  );

  it('serializa evento com fuso e codifica IDs como segmentos de URL', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ id: 'event/id' }));
    const provider = google(fetchImpl, 'team/calendar@example.test');
    await expect(provider.createEvent(event)).resolves.toEqual({ externalId: 'event/id' });
    await provider.updateEvent('event/id', event);
    const [createUrl, createInit] = fetchImpl.mock.calls[0]!;
    expect(createUrl).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/team%2Fcalendar%40example.test/events',
    );
    expect(createInit?.method).toBe('POST');
    expect(JSON.parse(createInit?.body as string)).toEqual({
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start.toISOString(), timeZone: event.timezone },
      end: { dateTime: event.end.toISOString(), timeZone: event.timezone },
    });
    expect(fetchImpl.mock.calls[1]![0]).toBe(`${createUrl}/event%2Fid`);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe('PATCH');
  });

  it('recusa criação sem ID retornado', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    await expect(google(fetchImpl).createEvent(event)).rejects.toThrow('ID do evento');
  });

  it('interpreta evento com horários e usa UTC quando fuso não é retornado', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 'event',
        status: 'confirmed',
        summary: 'Consulta',
        start: { dateTime: event.start.toISOString() },
        end: { dateTime: event.end.toISOString() },
      }),
    );
    await expect(google(fetchImpl).getEvent('event')).resolves.toMatchObject({
      externalId: 'event',
      title: 'Consulta',
      start: event.start,
      end: event.end,
      timezone: 'UTC',
      status: 'confirmed',
    });
  });

  it('consulta ausente retorna null e delete tolera ausência ou 204', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = google(fetchImpl);
    await expect(provider.getEvent('missing')).resolves.toBeNull();
    await expect(provider.deleteEvent('missing')).resolves.toBeUndefined();
    await expect(provider.deleteEvent('present')).resolves.toBeUndefined();
  });

  it.each(['update', 'create', 'availability'] as const)(
    'recusa 404 em %s sem tratá-lo como operação concluída',
    async (operation) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private provider body', { status: 404 }));
      const provider = google(fetchImpl);
      const operations = {
        update: () => provider.updateEvent('missing', event),
        create: () => provider.createEvent(event),
        availability: () => provider.getAvailability(event),
      };
      await expect(operations[operation]()).rejects.toMatchObject({
        code: 'INTEGRATION_ERROR',
        retryable: false,
        message: 'Google Calendar respondeu 404.',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [401, false],
    [403, false],
    [429, true],
    [500, true],
  ])('classifica falha Calendar HTTP %i', async (status, retryable) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private provider body', { status }));
    await expect(google(fetchImpl).getAvailability(event)).rejects.toMatchObject({
      code: 'INTEGRATION_ERROR',
      retryable,
      message: `Google Calendar respondeu ${status}.`,
    });
  });
});

describe('calendário em memória', () => {
  it('cria, move e remove evento sem manter ocupação antiga', async () => {
    const provider = new MockCalendarProvider();
    const { externalId } = await provider.createEvent(event);
    await expect(provider.getAvailability(event)).resolves.toEqual([
      { start: event.start, end: event.end },
    ]);
    const moved = { ...event, start: event.end, end: new Date('2026-01-16T14:00:00Z') };
    await provider.updateEvent(externalId, moved);
    await expect(provider.getAvailability(event)).resolves.toEqual([]);
    await expect(provider.getEvent(externalId)).resolves.toMatchObject({ ...moved, externalId });
    await provider.deleteEvent(externalId);
    await provider.deleteEvent(externalId);
    await expect(provider.getAvailability(moved)).resolves.toEqual([]);
    await expect(provider.getEvent(externalId)).resolves.toBeNull();
    await expect(provider.updateEvent(externalId, event)).rejects.toThrow('não encontrado');
  });

  it('inclui sobreposição parcial e exclui intervalos apenas adjacentes', async () => {
    const provider = new MockCalendarProvider();
    const partial = {
      start: new Date('2026-01-16T11:30:00Z'),
      end: new Date('2026-01-16T12:30:00Z'),
    };
    provider.busy = [
      partial,
      { start: new Date('2026-01-16T11:00:00Z'), end: event.start },
      { start: event.end, end: new Date('2026-01-16T14:00:00Z') },
    ];
    await expect(provider.getAvailability(event)).resolves.toEqual([partial]);
  });
});
