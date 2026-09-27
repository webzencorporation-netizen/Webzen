import { Prisma, systemDb } from '@botsaas/database';

export interface KnowledgeHit {
  id: string;
  title: string;
  content: string;
  type: string;
  score: number;
}

/**
 * Recuperação de conhecimento (RAG simples) com busca full-text do PostgreSQL.
 * SQL cru NÃO passa pelo client com escopo — por isso o filtro por companyId é explícito
 * e obrigatório nesta função (e coberto por teste de isolamento).
 *
 * Interface pensada para trocar por busca vetorial (pgvector) no futuro sem mudar chamadores.
 */
export interface KnowledgeRetriever {
  search(companyId: string, query: string, limit?: number): Promise<KnowledgeHit[]>;
}

const MAX_QUERY_LENGTH = 300;

export class PostgresKnowledgeRetriever implements KnowledgeRetriever {
  async search(companyId: string, rawQuery: string, limit = 4): Promise<KnowledgeHit[]> {
    if (!companyId) throw new Error('companyId obrigatório na busca de conhecimento');
    const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
    if (query.length < 2) return [];

    // 1) Full-text em português, sem acentos; OR entre termos para tolerar frases longas.
    const terms = query
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
      .slice(0, 12);
    const orQuery = terms.join(' OR ');

    const fullText = orQuery
      ? await systemDb.$queryRaw<KnowledgeHit[]>(Prisma.sql`
          SELECT id, title, content, type::text AS type,
                 ts_rank_cd("searchVector", websearch_to_tsquery('portuguese', immutable_unaccent(${orQuery}))) AS score
          FROM "KnowledgeEntry"
          WHERE "companyId" = ${companyId}::uuid
            AND "isActive" = true
            AND "searchVector" @@ websearch_to_tsquery('portuguese', immutable_unaccent(${orQuery}))
          ORDER BY score DESC, "updatedAt" DESC
          LIMIT ${limit}`)
      : [];
    if (fullText.length > 0) return fullText.map((hit) => ({ ...hit, score: Number(hit.score) }));

    // 2) Fallback por similaridade de título (erros de digitação).
    const similar = await systemDb.$queryRaw<KnowledgeHit[]>(Prisma.sql`
      SELECT id, title, content, type::text AS type, similarity(title, ${query}) AS score
      FROM "KnowledgeEntry"
      WHERE "companyId" = ${companyId}::uuid
        AND "isActive" = true
        AND similarity(title, ${query}) > 0.2
      ORDER BY score DESC
      LIMIT ${limit}`);
    return similar.map((hit) => ({ ...hit, score: Number(hit.score) }));
  }
}

export const knowledgeRetriever: KnowledgeRetriever = new PostgresKnowledgeRetriever();
