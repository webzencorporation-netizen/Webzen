import { randomUUID } from 'node:crypto';
import { buildObjectKey } from '@botsaas/integrations';
import { NotFoundError, ValidationError } from '@botsaas/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';

/** Tipos aceitos na base de conhecimento. Nada executável; conteúdo validado por assinatura. */
const ALLOWED: Record<string, { mime: string; kind: 'pdf' | 'text' }> = {
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  txt: { mime: 'text/plain', kind: 'text' },
  md: { mime: 'text/markdown', kind: 'text' },
  csv: { mime: 'text/csv', kind: 'text' },
};

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 400;

export function detectDocumentType(
  fileName: string,
  data: Buffer,
): { mime: string; kind: 'pdf' | 'text'; extension: string } {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const allowed = ALLOWED[extension];
  if (!allowed) throw new ValidationError('Formato não suportado. Envie PDF, TXT, MD ou CSV.');
  if (allowed.kind === 'pdf' && data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ValidationError('O arquivo não é um PDF válido.');
  }
  if (allowed.kind === 'text') {
    if (data.includes(0))
      throw new ValidationError('Arquivo de texto inválido (conteúdo binário).');
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(data);
    if (decoded.includes('�') && decoded.split('�').length > 20)
      throw new ValidationError('Arquivo precisa estar em UTF-8.');
  }
  return { ...allowed, extension };
}

/** Divide texto em trechos com sobreposição, preferindo quebras de parágrafo. */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const paragraph = clean.lastIndexOf('\n\n', end);
      const sentence = clean.lastIndexOf('. ', end);
      const boundary =
        paragraph > start + size / 2 ? paragraph : sentence > start + size / 2 ? sentence + 1 : end;
      end = boundary;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

export async function uploadKnowledgeDocument(
  scope: CompanyScope,
  input: { title: string; fileName: string; data: Buffer },
) {
  const type = detectDocumentType(input.fileName, input.data);
  const key = buildObjectKey(scope.companyId, 'knowledge', `${randomUUID()}.${type.extension}`);
  await scope.container.providers.storage.put(key, input.data, { contentType: type.mime });
  const document = await scope.db.knowledgeDocument.create({
    data: {
      companyId: scope.companyId,
      title: input.title,
      fileName: input.fileName.slice(0, 200),
      mimeType: type.mime,
      sizeBytes: input.data.length,
      storageKey: key,
      status: 'PENDING',
    },
  });
  await scope.container.queue.enqueue(
    'knowledge.process-document',
    { companyId: scope.companyId, documentId: document.id },
    { jobId: `doc-${document.id}` },
  );
  await audit(scope, {
    action: 'knowledge.document_uploaded',
    resourceType: 'KnowledgeDocument',
    resourceId: document.id,
    metadata: { fileName: document.fileName, sizeBytes: document.sizeBytes },
  });
  return document;
}

async function extractDocumentText(data: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n\n') : text;
  }
  return new TextDecoder('utf-8').decode(data);
}

/** Job `knowledge.process-document`: extrai texto, fatia e cria entradas pesquisáveis. */
export async function processKnowledgeDocument(scope: CompanyScope, documentId: string) {
  const document = await scope.db.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document?.storageKey || document.status === 'PROCESSED') return;
  await scope.db.knowledgeDocument.update({
    where: { id: document.id },
    data: { status: 'PROCESSING', error: null },
  });
  try {
    const data = await scope.container.providers.storage.get(document.storageKey);
    const chunks = chunkText(await extractDocumentText(data, document.mimeType ?? 'text/plain'));
    if (chunks.length === 0)
      throw new ValidationError('Nenhum texto encontrado no documento (PDF escaneado?).');
    await scope.db.knowledgeEntry.deleteMany({ where: { documentId: document.id } });
    await scope.db.knowledgeEntry.createMany({
      data: chunks.map((content, index) => ({
        companyId: scope.companyId,
        documentId: document.id,
        chunkIndex: index,
        type: 'DOCUMENT' as const,
        title: chunks.length > 1 ? `${document.title} (parte ${index + 1})` : document.title,
        content,
      })),
    });
    await scope.db.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: 'PROCESSED' },
    });
  } catch (error) {
    await scope.db.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        status: 'FAILED',
        error: (error instanceof Error ? error.message : 'erro').slice(0, 300),
      },
    });
  }
}

export async function deleteKnowledgeDocument(scope: CompanyScope, documentId: string) {
  const document = await scope.db.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundError('Documento não encontrado.');
  if (document.storageKey) await scope.container.providers.storage.delete(document.storageKey);
  await scope.db.knowledgeDocument.delete({ where: { id: documentId } });
  await audit(scope, {
    action: 'knowledge.document_deleted',
    resourceType: 'KnowledgeDocument',
    resourceId: documentId,
    metadata: { title: document.title },
  });
}
