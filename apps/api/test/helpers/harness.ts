import { MockAIProvider } from '@botsaas/ai';
import { parseEnv, resetEnvCache } from '@botsaas/config';
import {
  getSystemDb,
  hashPassword,
  systemDb,
  type CompanyRole,
  type PlatformRole,
} from '@botsaas/database';
import { truncateAllTables } from '@botsaas/database/testing';
import { MemoryObjectStorage, MockSpeechToText } from '@botsaas/integrations';
import type { BusinessTemplateKey } from '@botsaas/shared';
import { MockMessagingProvider } from '@botsaas/whatsapp';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import pino from 'pino';
import { buildApp } from '../../src/app';
import { createContainer, type AppContainer } from '../../src/container';
import { createCompany } from '../../src/modules/platform/companies.service';
import { InMemoryJobQueue } from '../../src/queues/memory';
import { seedReferenceData } from '../../src/seed/reference';

export const DEFAULT_PASSWORD = 'senha-de-teste-123';

export interface TestHarness {
  app: FastifyInstance;
  container: AppContainer;
  queue: InMemoryJobQueue;
  ai: MockAIProvider;
  messaging: MockMessagingProvider;
  storage: MemoryObjectStorage;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  resetEnvCache();
  const env = parseEnv(process.env);
  const queue = new InMemoryJobQueue();
  const ai = new MockAIProvider();
  const messaging = new MockMessagingProvider();
  const storage = new MemoryObjectStorage();
  const container = createContainer({
    env,
    logger: pino({ level: 'silent' }),
    queue,
    providers: { ai, messaging, storage, speechToText: new MockSpeechToText() },
  });
  const app = await buildApp(container);
  await app.ready();
  return {
    app,
    container,
    queue,
    ai,
    messaging,
    storage,
    async reset() {
      await truncateAllTables(getSystemDb());
      await seedReferenceData();
      queue.clear();
      ai.reset();
      messaging.reset();
      storage.objects.clear();
    },
    async close() {
      await app.close();
    },
  };
}

export async function createUser(input: {
  email: string;
  name?: string;
  platformRole?: PlatformRole;
  password?: string;
}) {
  return systemDb.user.create({
    data: {
      email: input.email,
      name: input.name ?? input.email.split('@')[0] ?? 'Usuário',
      passwordHash: await hashPassword(input.password ?? DEFAULT_PASSWORD),
      platformRole: input.platformRole ?? null,
    },
  });
}

export async function createCompanyFixture(
  harness: TestHarness,
  input: { name: string; ownerEmail: string; templateKey?: BusinessTemplateKey; planKey?: string },
) {
  const { company } = await createCompany(
    harness.container,
    { type: 'SYSTEM', label: 'test' },
    {
      name: input.name,
      templateKey: input.templateKey ?? 'CLINIC',
      timezone: 'America/Sao_Paulo',
      planKey: input.planKey ?? 'PRO',
      owner: { email: input.ownerEmail, name: `Dono ${input.name}`, password: DEFAULT_PASSWORD },
    },
  );
  await systemDb.company.update({ where: { id: company.id }, data: { status: 'ACTIVE' } });
  return company;
}

export async function addMember(companyId: string, email: string, role: CompanyRole) {
  const user =
    (await systemDb.user.findUnique({ where: { email } })) ?? (await createUser({ email }));
  await systemDb.companyMember.create({ data: { companyId, userId: user.id, role } });
  return user;
}

export interface TestClient {
  cookie: string;
  request(options: InjectOptions): Promise<LightMyRequestResponse>;
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  patch(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  put(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  delete(url: string): Promise<LightMyRequestResponse>;
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = DEFAULT_PASSWORD,
): Promise<TestClient> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-requested-with': 'test' },
    payload: { email, password },
  });
  if (response.statusCode !== 200)
    throw new Error(`login falhou (${response.statusCode}): ${response.body}`);
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = raw?.split(';')[0] ?? '';
  const request = (options: InjectOptions) =>
    app.inject({
      ...options,
      headers: { cookie, 'x-requested-with': 'test', ...(options.headers ?? {}) },
    });
  return {
    cookie,
    request,
    get: (url) => request({ method: 'GET', url }),
    post: (url, payload) =>
      request({ method: 'POST', url, payload: payload as InjectOptions['payload'] }),
    patch: (url, payload) =>
      request({ method: 'PATCH', url, payload: payload as InjectOptions['payload'] }),
    put: (url, payload) =>
      request({ method: 'PUT', url, payload: payload as InjectOptions['payload'] }),
    delete: (url) => request({ method: 'DELETE', url }),
  };
}
