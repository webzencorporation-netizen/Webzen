import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { deleteContact } from '../src/modules/company/contacts/service';
import { deleteConversation } from '../src/modules/company/conversations/service';
import { deleteKnowledgeDocument } from '../src/modules/company/knowledge/documents';
import { runRetention } from '../src/modules/maintenance/service';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => {
  vi.restoreAllMocks();
  await harness.reset();
});

async function fixture(name = 'cleanup') {
  const company = await createCompanyFixture(harness, { name, ownerEmail: `${name}@cleanup.test` });
  const scope = systemScope(harness.container, company.id);
  const contact = await scope.db.contact.create({
    data: { companyId: company.id, phone: '551199998888' },
  });
  const conversation = await scope.db.conversation.create({
    data: { companyId: company.id, contactId: contact.id },
  });
  const message = await scope.db.message.create({
    data: {
      companyId: company.id,
      conversationId: conversation.id,
      direction: 'INBOUND',
      sender: 'CONTACT',
      type: 'IMAGE',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const storageKey = `${company.id}/media/image`;
  const media = await scope.db.mediaAsset.create({
    data: {
      companyId: company.id,
      messageId: message.id,
      kind: 'IMAGE',
      storageKey,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await harness.storage.put(storageKey, Buffer.from('image'));
  return { company, scope, contact, conversation, message, media, storageKey };
}

describe('exclusão de objetos sem perder referências após falha', () => {
  it.each(['contact', 'conversation', 'document'] as const)(
    '%s preserva dados para repetir exclusão',
    async (kind) => {
      const f = await fixture();
      const document = await f.scope.db.knowledgeDocument.create({
        data: {
          companyId: f.company.id,
          title: 'Documento',
          storageKey: `${f.company.id}/knowledge/file`,
        },
      });
      await harness.storage.put(document.storageKey!, Buffer.from('document'));
      const operation = () =>
        kind === 'contact'
          ? deleteContact(f.scope, f.contact.id)
          : kind === 'conversation'
            ? deleteConversation(f.scope, f.conversation.id)
            : deleteKnowledgeDocument(f.scope, document.id);
      const failure = new Error('Storage unavailable');
      const deletion = vi.spyOn(harness.storage, 'delete').mockRejectedValueOnce(failure);
      await expect(operation()).rejects.toBe(failure);
      expect(await f.scope.db.contact.findUnique({ where: { id: f.contact.id } })).not.toBeNull();
      expect(
        await f.scope.db.conversation.findUnique({ where: { id: f.conversation.id } }),
      ).not.toBeNull();
      expect(await f.scope.db.mediaAsset.findUnique({ where: { id: f.media.id } })).not.toBeNull();
      expect(
        await f.scope.db.knowledgeDocument.findUnique({ where: { id: document.id } }),
      ).not.toBeNull();
      expect(await f.scope.db.auditLog.count({ where: { action: { endsWith: 'deleted' } } })).toBe(
        0,
      );
      deletion.mockRestore();
      await operation();
      expect(
        await harness.storage.exists(kind === 'document' ? document.storageKey! : f.storageKey),
      ).toBe(false);
      expect(await f.scope.db.auditLog.count({ where: { action: { endsWith: 'deleted' } } })).toBe(
        1,
      );
      if (kind === 'document') {
        expect(
          await f.scope.db.knowledgeDocument.findUnique({ where: { id: document.id } }),
        ).toBeNull();
        expect(await f.scope.db.conversation.count()).toBe(1);
      } else {
        expect(await f.scope.db.conversation.count()).toBe(0);
        expect(await f.scope.db.message.count()).toBe(0);
        expect(await f.scope.db.mediaAsset.count()).toBe(0);
        expect(await f.scope.db.contact.count()).toBe(kind === 'contact' ? 0 : 1);
      }
    },
  );

  it('retenção falha sem perder a referência e conclui na próxima execução', async () => {
    const f = await fixture();
    await systemDb.company.update({
      where: { id: f.company.id },
      data: { messageRetentionDays: 30 },
    });
    const deletion = vi
      .spyOn(harness.storage, 'delete')
      .mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(runRetention(harness.container, new Date('2026-03-01T00:00:00Z'))).rejects.toThrow(
      'Falha na retenção',
    );
    expect(await f.scope.db.mediaAsset.findUnique({ where: { id: f.media.id } })).not.toBeNull();
    expect(await f.scope.db.message.findUnique({ where: { id: f.message.id } })).not.toBeNull();
    deletion.mockRestore();
    expect(await runRetention(harness.container, new Date('2026-03-01T00:00:00Z'))).toMatchObject({
      messages: 1,
    });
    expect(await harness.storage.exists(f.storageKey)).toBe(false);
    expect(await f.scope.db.mediaAsset.count()).toBe(0);
  });

  it('retenção remove também objeto criado recentemente cuja mensagem será expurgada', async () => {
    const f = await fixture();
    await systemDb.company.update({
      where: { id: f.company.id },
      data: { messageRetentionDays: 30 },
    });
    await f.scope.db.mediaAsset.update({
      where: { id: f.media.id },
      data: { createdAt: new Date('2026-02-28T00:00:00Z') },
    });
    const other = await fixture('other');
    await runRetention(harness.container, new Date('2026-03-01T00:00:00Z'));
    expect(await harness.storage.exists(f.storageKey)).toBe(false);
    expect(await f.scope.db.message.count()).toBe(0);
    expect(await other.scope.db.message.count()).toBe(1);
    expect(await harness.storage.exists(other.storageKey)).toBe(true);
  });

  it('exclusão pelo escopo de outra empresa não alcança objetos nem registros', async () => {
    const target = await fixture();
    const other = await fixture('other');
    const deletion = vi.spyOn(harness.storage, 'delete');
    await expect(deleteContact(other.scope, target.contact.id)).rejects.toThrow();
    await expect(deleteConversation(other.scope, target.conversation.id)).rejects.toThrow();
    expect(deletion).not.toHaveBeenCalled();
    expect(await harness.storage.exists(target.storageKey)).toBe(true);
  });

  it('falha de uma empresa não impede a retenção das demais e deixa o job como falho', async () => {
    const first = await fixture();
    const second = await fixture('other');
    await systemDb.company.updateMany({ data: { messageRetentionDays: 30 } });
    const originalDelete = harness.storage.delete.bind(harness.storage);
    vi.spyOn(harness.storage, 'delete').mockImplementation(async (key) => {
      if (key === first.storageKey) throw new Error('Storage unavailable');
      await originalDelete(key);
    });
    await expect(
      runRetention(harness.container, new Date('2026-03-01T00:00:00Z')),
    ).rejects.toThrow();
    expect(await first.scope.db.message.count()).toBe(1);
    expect(await harness.storage.exists(first.storageKey)).toBe(true);
    expect(await second.scope.db.message.count()).toBe(0);
    expect(await harness.storage.exists(second.storageKey)).toBe(false);
  });

  it('retry conclui exclusão após remover apenas parte dos objetos', async () => {
    const f = await fixture();
    const secondKey = `${f.company.id}/media/second`;
    await f.scope.db.mediaAsset.create({
      data: {
        companyId: f.company.id,
        messageId: f.message.id,
        kind: 'IMAGE',
        storageKey: secondKey,
      },
    });
    await harness.storage.put(secondKey, Buffer.from('second'));
    const originalDelete = harness.storage.delete.bind(harness.storage);
    let calls = 0;
    const deletion = vi.spyOn(harness.storage, 'delete').mockImplementation(async (key) => {
      if (++calls === 2) throw new Error('Storage unavailable');
      await originalDelete(key);
    });
    await expect(deleteConversation(f.scope, f.conversation.id)).rejects.toThrow(
      'Storage unavailable',
    );
    expect(harness.storage.objects.size).toBe(1);
    expect(await f.scope.db.mediaAsset.count()).toBe(2);
    expect(await f.scope.db.conversation.count()).toBe(1);
    deletion.mockRestore();
    await deleteConversation(f.scope, f.conversation.id);
    expect(harness.storage.objects.size).toBe(0);
    expect(await f.scope.db.mediaAsset.count()).toBe(0);
    expect(await f.scope.db.conversation.count()).toBe(0);
  });
});
