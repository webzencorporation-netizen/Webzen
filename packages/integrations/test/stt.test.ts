import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisabledSpeechToText, MockSpeechToText, OpenAICompatibleSpeechToText } from '../src/stt';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Rede real proibida neste teste');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('transcrição', () => {
  it('modo desativado falha sem rede; mock retorna texto configurado', async () => {
    const disabled = new DisabledSpeechToText();
    expect(disabled.enabled).toBe(false);
    await expect(disabled.transcribe()).rejects.toMatchObject({
      code: 'INTEGRATION_ERROR',
      retryable: false,
    });
    await expect(new MockSpeechToText('Quero agendar').transcribe()).resolves.toEqual({
      text: 'Quero agendar',
      language: 'pt',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['audio/ogg; codecs=opus', 'audio/ogg', 'ogg'],
    ['audio/mpeg', 'audio/mpeg', 'mp3'],
    ['audio/mp4', 'audio/mp4', 'm4a'],
    ['audio/wav', 'audio/wav', 'wav'],
  ])('envia multipart preservando bytes de %s', async (mimeType, fileType, extension) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: '  Olá\n', duration: 3.5, language: 'pt' }));
    const provider = new OpenAICompatibleSpeechToText({
      url: 'https://stt.invalid/transcribe',
      apiKey: 'fixture-key',
      model: 'fixture-model',
      fetchImpl,
    });
    const bytes = Buffer.from([0, 1, 255, 42]);
    await expect(provider.transcribe(bytes, { mimeType, language: 'pt' })).resolves.toEqual({
      text: 'Olá',
      durationSeconds: 3.5,
      language: 'pt',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://stt.invalid/transcribe');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-key' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('fixture-model');
    expect(form.get('language')).toBe('pt');
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file') as File;
    expect(file.name).toBe(`audio.${extension}`);
    expect(file.type).toBe(fileType);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
  });

  it('usa o modelo default e omite idioma quando não informados', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: '' }));
    const provider = new OpenAICompatibleSpeechToText({
      url: 'https://stt.invalid',
      apiKey: 'fixture-key',
      fetchImpl,
    });
    await provider.transcribe(Buffer.from('audio'), { mimeType: 'audio/webm' });
    const form = fetchImpl.mock.calls[0]![1]!.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.has('language')).toBe(false);
  });

  it.each([
    [400, false],
    [401, false],
    [429, true],
    [500, true],
    [503, true],
  ])('classifica HTTP %i sem expor o corpo do provider', async (status, retryable) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('fixture-private-response', { status }));
    const provider = new OpenAICompatibleSpeechToText({
      url: 'https://stt.invalid',
      apiKey: 'fixture-key',
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from('audio'), { mimeType: 'audio/ogg' }),
    ).rejects.toMatchObject({
      code: 'INTEGRATION_ERROR',
      retryable,
      message: `Serviço de transcrição respondeu ${status}.`,
    });
  });
});
