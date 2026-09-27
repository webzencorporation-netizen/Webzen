# Decisões arquiteturais (ADR resumido)

Cada decisão tem: contexto, decisão, consequências. Novas decisões vão no fim do arquivo.

---

## D-001 — Monólito modular em monorepo pnpm

**Contexto:** plataforma multiempresa que começa com onboarding manual e evolui para SaaS self-service. A equipe é pequena.

**Decisão:** monorepo pnpm workspaces com:

- `apps/api` — API HTTP (Fastify) **e** worker de filas (mesmo código, dois entrypoints: `src/main.ts` e `src/worker.ts`).
- `apps/web` — painel Next.js (App Router).
- `packages/*` — bibliotecas internas (`config`, `shared`, `database`, `ai`, `whatsapp`, `integrations`).

Pacotes internos exportam TypeScript fonte (padrão "internal packages"); o Next transpila via `transpilePackages` e a API roda com `tsx` em dev e é empacotada com esbuild para produção.

**Consequências:** um deploy de API + um de worker + um do web. Sem microserviços. Módulos de domínio ficam em `apps/api/src/modules/*`, com fronteiras claras para extração futura se necessário.

## D-002 — Fastify + Zod

Fastify 5 (maduro, rápido, hooks por rota) com validação Zod 4 (`fastify-type-provider-zod`). Schemas de payload compartilhados com o frontend ficam em `packages/shared`.

## D-003 — PostgreSQL + Prisma 7 (driver adapter `pg`)

Prisma 7.x estável (a tag `latest` do npm aponta para 8.0 RC, que **não** foi adotada). Prisma 7 exige `prisma.config.ts`, gerador `prisma-client` e driver adapter (`@prisma/adapter-pg`).

## D-004 — Isolamento multi-tenant por `companyId` + client com escopo

- Banco único, schema único, coluna `companyId` em toda entidade empresarial (sem banco por empresa no MVP).
- `packages/database` expõe `createTenantClient(companyId)` — uma extensão Prisma que **injeta `companyId` em todo `where`/`data`** dos modelos empresariais e **rejeita** operações que tentem usar outro `companyId`.
- O client sem escopo é exportado como `systemDb` (nome deliberadamente explícito) e só pode ser usado em módulos de plataforma, auth, webhooks e jobs (regra ESLint `no-restricted-imports` nos módulos de empresa).
- O `companyId` **nunca** vem do payload do frontend: é derivado da sessão (empresa ativa validada contra `CompanyMember` a cada request).
- IDs de relacionamentos recebidos do frontend (ex.: `contactId`, `serviceId`) são sempre verificados pelo client com escopo antes do uso.
- Testes dedicados (`apps/api/test/tenant-isolation.test.ts`).

**Alternativa futura:** Row Level Security do PostgreSQL como segunda camada (documentado em `docs/MULTITENANCY.md`). Não adotado no MVP pela complexidade com pool de conexões.

## D-005 — Autenticação por sessão em cookie httpOnly

Senha com Argon2id (`@node-rs/argon2`, binário pré-compilado). Sessão opaca: token aleatório de 32 bytes no cookie `sid` (httpOnly, SameSite=Lax, Secure em produção); no banco só guardamos o SHA-256 do token. Empresa ativa e modo suporte ficam na sessão.

CSRF: cookie SameSite=Lax + exigência do header `X-Requested-With` em métodos mutáveis + verificação de `Origin` quando presente. O painel acessa a API via rewrite do Next (`/api/*`), então tudo é same-origin.

## D-006 — Filas com BullMQ + Redis

BullMQ para jobs com retry/backoff exponencial e limite de tentativas. Idempotência por `jobId` determinístico e verificações no banco (ex.: `WebhookEvent` único por `(provider, externalId)`; `Message.externalId` único por empresa).

## D-007 — Agrupamento de mensagens (debounce) com job atrasado + verificação no banco

Cada mensagem recebida agenda o job `agent-reply` com `jobId` por conversa e atraso = `messageBufferSeconds`. O processador:

1. adquire lock por conversa (advisory lock do Postgres);
2. carrega mensagens de entrada ainda não respondidas (`agentHandledAt IS NULL`);
3. se a mais recente é mais nova que o buffer, reagenda para o tempo restante;
4. caso contrário, agrupa todas em um único input e chama o agente uma vez.

A lógica de decisão é uma função pura testável (`packages/ai/src/buffer.ts`).

## D-008 — Claude via `@anthropic-ai/sdk`, modelo configurável

- Interface `AIProvider` com implementações `AnthropicProvider` e `MockAIProvider` (dev/testes; em produção exige flag explícita).
- Modelo padrão `claude-opus-5`; configurável por empresa (`AIConfiguration.model`) e globalmente (`AI_DEFAULT_MODEL`). Preços em tabela `ModelPricing` editável.
- Loop manual de tools (controle total de autorização, logs e confirmação de ações).
- `effort` configurável (padrão `medium` — atendimento por chat raramente se beneficia de raciocínio profundo; ajuste por empresa).
- Prompt caching: blocos estáveis do system prompt (base + template + perfil da empresa) marcados com `cache_control`; contexto volátil (data/hora, memória do contato, conhecimento recuperado) vai depois do breakpoint.
- Refusal fallback server-side (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) habilitável por configuração (`AI_REFUSAL_FALLBACK=true`); `stop_reason: "refusal"` sempre tratado.
- Não armazenamos chain-of-thought: blocos `thinking` são repassados dentro do loop de uma execução e descartados depois.

## D-009 — Transcrição de áudio desacoplada

A Claude API não oferece transcrição de áudio. `SpeechToTextProvider` com implementações `none` (padrão — áudio fica marcado como "não transcrito" e o agente recebe aviso), `mock` e `openai-compatible` (HTTP multipart; funciona com qualquer endpoint compatível com `/audio/transcriptions`).

## D-010 — Base de conhecimento com busca full-text do PostgreSQL

MVP usa `tsvector` (config `portuguese` + `unaccent`) + `pg_trgm` para fallback por similaridade. Sem embeddings no MVP (a Anthropic não fornece embeddings; exigiria outro fornecedor). Interface `KnowledgeRetriever` permite plugar busca vetorial (pgvector) no futuro — sempre filtrando por `companyId`.

## D-011 — WhatsApp Cloud API oficial, versão configurável

- Graph API versão via `WHATSAPP_GRAPH_API_VERSION` (padrão `v25.0`, a atual em set/2026).
- Webhook: verificação `hub.mode/hub.verify_token/hub.challenge`; validação `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o App Secret) em comparação de tempo constante.
- Credenciais por número (`WhatsAppAccount`) com token de acesso **criptografado** (AES-256-GCM, chave `ENCRYPTION_KEY`).
- Janela de atendimento de 24h (a partir da última mensagem do cliente): dentro dela, mensagens livres; fora, somente templates aprovados. Regra centralizada em `packages/whatsapp/src/window.ts`.
- Preço por mensagem (vigente desde jul/2025; mudanças anunciadas para out/2026 sobre mensagens utility na janela) é **informativo** — não calculamos cobrança da Meta no MVP.

## D-012 — Armazenamento de objetos e calendário por provider

`ObjectStorageProvider` (`local` em dev, `s3` para S3/R2/compatíveis) e `CalendarProvider` (`internal` agenda própria, `google` via OAuth, `mock` para testes). O domínio não conhece APIs externas.

## D-013 — Frontend

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + primitivos Radix (acessibilidade) + TanStack Query para dados. Componentes de UI próprios em `apps/web/src/components/ui` (estilo shadcn, sem gerador). Textos em pt-BR centralizados em `apps/web/src/i18n` para permitir i18n futuro.

## D-014 — Dev sem Docker

`docker-compose.yml` sobe Postgres + Redis. Para máquinas sem Docker, `pnpm services:local` usa `embedded-postgres` (binários oficiais) e `redis-memory-server`. Os testes de integração usam o mesmo mecanismo automaticamente quando `TEST_DATABASE_URL` não é fornecida.

## D-015 — TypeScript 6.0

TypeScript 7 (port nativo) já é `latest`, mas `typescript-eslint` suporta até `<6.1`. Fixamos TS 6.0.x até o ecossistema acompanhar.
