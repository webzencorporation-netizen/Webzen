import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { patchSchema } from '../src/lib/http';
import {
  createCompanyFixture,
  createTestHarness,
  login,
  type TestHarness,
} from './helpers/harness';

/**
 * Regressão: no Zod 4, `.partial()` mantém os `.default()`. Um PATCH só com o nome
 * regravava os valores padrão por cima dos atuais (automação reativada e sem condições,
 * entrada de FAQ virando texto, plano desativado reativado).
 */
let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

describe('patchSchema', () => {
  it('campos ausentes continuam ausentes, mesmo com default no schema de criação', () => {
    const create = z.object({ name: z.string(), active: z.boolean().default(true) });
    expect(create.partial().parse({ name: 'x' })).toEqual({ name: 'x', active: true });
    expect(patchSchema(create).parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(patchSchema(create).parse({ active: false })).toEqual({ active: false });
  });
});

describe('PATCH parcial preserva o que não foi enviado', () => {
  it('renomear automação não reativa nem apaga condições', async () => {
    await createCompanyFixture(harness, { name: 'Ótica', ownerEmail: 'dono@otica.test' });
    const owner = await login(harness.app, 'dono@otica.test');
    const created = await owner.post('/api/app/automations', {
      name: 'Boas-vindas',
      trigger: 'contact.created',
      conditions: [{ field: 'contact.source', op: 'eq', value: 'whatsapp' }],
      actions: [{ type: 'add_tag', tagName: 'novo' }],
      isActive: false,
    });
    expect(created.statusCode).toBe(201);

    const renamed = await owner.patch(`/api/app/automations/${created.json().id}`, {
      name: 'Boas-vindas 2',
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      name: 'Boas-vindas 2',
      isActive: false,
      conditions: [{ field: 'contact.source', op: 'eq', value: 'whatsapp' }],
    });
  });

  it('editar o título de uma FAQ não muda o tipo da entrada', async () => {
    await createCompanyFixture(harness, { name: 'Pizzaria', ownerEmail: 'dono@pizza.test' });
    const owner = await login(harness.app, 'dono@pizza.test');
    const created = await owner.post('/api/app/knowledge/entries', {
      type: 'FAQ',
      title: 'Vocês entregam?',
      content: 'Sim, num raio de 5 km.',
    });
    expect(created.statusCode).toBe(201);
    const updated = await owner.patch(`/api/app/knowledge/entries/${created.json().id}`, {
      title: 'Fazem entrega?',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: 'Fazem entrega?', type: 'FAQ' });
  });
});
