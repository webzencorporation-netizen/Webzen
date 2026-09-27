# PROGRESS

> Fonte de verdade do estado do projeto. Atualize ao fim de cada fase/sessão.
> Última atualização: 2026-09-26

## Concluído

- **FASE 0 — Investigação**
  - Repositório vazio inspecionado; git inicializado.
  - Documentação atual consultada: Anthropic (modelos, tool use, caching, refusal fallback), Meta WhatsApp Cloud API (webhooks, assinatura, janela de 24h, preços por mensagem, Graph API v25.0), Prisma 7.
  - `DECISIONS.md` (D-001…D-015) e `docs/TECHNICAL_PLAN.md`.
- **FASE 1 — Fundação (parcial)**
  - Monorepo pnpm, TS 6, ESLint 10 + Prettier, tsconfig base.
  - `packages/config` (env validado com Zod + regras de produção que proíbem mocks).
  - `packages/shared` (enums, erros classificados, RBAC por permissões).
  - `packages/database` (schema Prisma completo, migração inicial com busca full-text, client com escopo de tenant + testes).
  - `docker-compose.yml` + `pnpm services:local` (Postgres/Redis sem Docker).

## Em andamento

- FASE 1: API Fastify, worker, painel Next.js, testes de integração.

## Próximos passos

Ver fases no `docs/TECHNICAL_PLAN.md`.

## Problemas conhecidos

- `prisma migrate dev` pode travar em terminal não interativo; use `prisma migrate dev --create-only` + `prisma migrate deploy`.

## Decisões arquiteturais

Ver `DECISIONS.md`.
