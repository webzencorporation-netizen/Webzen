# BotsSaaS — Atendentes virtuais com IA para WhatsApp

Plataforma **multiempresa** (multi-tenant) de atendimento no WhatsApp com IA: uma base de código atende clínicas, barbearias, restaurantes, lojas, imobiliárias e serviços locais. Cada empresa tem seu ambiente isolado (WhatsApp, equipe, contatos, conversas, agente, conhecimento, CRM, agenda, consumo).

- **WhatsApp:** API oficial da Meta (WhatsApp Business Platform — Cloud API). Nada de WhatsApp Web/scraping.
- **IA:** Anthropic Claude via `@anthropic-ai/sdk`, com tools controladas pelo backend.
- **Stack:** monorepo pnpm · Fastify + Zod · Prisma 7 + PostgreSQL · BullMQ + Redis · Next.js 16 + React 19 + Tailwind 4.

> Estado atual, próximos passos e problemas conhecidos: [`PROGRESS.md`](PROGRESS.md). Decisões: [`DECISIONS.md`](DECISIONS.md).

## Como funciona

```
Cliente → WhatsApp → Meta Cloud API → POST /webhooks/whatsapp
   valida assinatura → deduplica → identifica empresa (phone_number_id) → persiste → fila
   → worker: agrupa mensagens (debounce) → AgentEngine (Claude + tools) → envia resposta
Equipe → Painel (Next.js) → /api/* (mesma origem, cookie de sessão) → API
```

## Requisitos

- Node.js ≥ 22.12 e pnpm (via Corepack: `corepack enable pnpm`)
- PostgreSQL 16+ e Redis 7+ — via **Docker** (`docker compose up -d`) **ou** sem Docker (`pnpm services:local`, que sobe PostgreSQL embarcado e Redis locais em `.local/`)

## Primeiros passos

```bash
pnpm install
cp .env.example .env               # gere ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d               # ou, sem Docker: pnpm services:local (deixe rodando)
pnpm db:migrate:deploy             # aplica as migrações
pnpm db:seed                       # planos, preços de modelos e a "Clínica Demo"
pnpm dev                           # API (:4000) + painel (:3000)
pnpm dev:worker                    # em outro terminal: filas (IA, envio, mídia, automações)
```

Acesse http://localhost:3000 — usuários de demonstração (senha `demo-senha-123`):

| Usuário                                                 | Acesso                               |
| ------------------------------------------------------- | ------------------------------------ |
| `admin@plataforma.local`                                | Área da plataforma (super admin)     |
| `dono@clinicademo.local`                                | Proprietário da Clínica Demo         |
| `gerente@` / `atendente@` / `leitura@clinicademo.local` | Gerente, atendente e somente leitura |

Sem credenciais externas, tudo roda com providers simulados (**mock**) — IA determinística e WhatsApp que não envia nada. Em **Integrações → Simulador de WhatsApp** você gera mensagens de cliente que passam pelo mesmo fluxo do webhook real; em **Agente de IA → Testar agente** você conversa com o atendente sem WhatsApp. Para usar a IA real: `AI_PROVIDER=anthropic` e `ANTHROPIC_API_KEY`.

## Scripts

| Comando                                                        | O que faz                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm dev:worker`                                 | API + painel em modo desenvolvimento / worker das filas                              |
| `pnpm build`                                                   | Build de produção (API e worker via esbuild, painel via Next)                        |
| `pnpm lint` · `pnpm typecheck` · `pnpm format`                 | Qualidade                                                                            |
| `pnpm test`                                                    | Testes unitários e de integração (usa `TEST_DATABASE_URL`)                           |
| `pnpm test:e2e`                                                | Playwright (sobe API, worker e painel isolados com banco `botsaas_e2e`)              |
| `pnpm test:build`                                              | Após o build: verifica imports/validação de API, worker e bootstrap do administrador |
| `pnpm homolog:anthropic` / `homolog:meta` / `homolog:whatsapp` | Homologação dos providers reais com credenciais (ver `docs/VALIDATION.md`)           |
| `pnpm db:migrate`                                              | Cria migração a partir do schema (desenvolvimento)                                   |
| `pnpm db:migrate:deploy`                                       | Aplica migrações pendentes                                                           |
| `pnpm db:seed`                                                 | Seed de desenvolvimento (recusado em produção; `-- --reference` só planos/preços)    |
| `pnpm services:local`                                          | PostgreSQL + Redis locais sem Docker                                                 |

## Estrutura

```
apps/
  api/        Fastify (HTTP) + worker BullMQ — módulos em src/modules
  web/        Painel Next.js (empresa em /app, plataforma em /platform)
packages/
  config/     Validação das variáveis de ambiente
  shared/     Enums, erros, RBAC, horário de funcionamento
  database/   Prisma schema/migrações, client com escopo de empresa, utilitários de teste
  ai/         AIProvider (Anthropic/mock), AgentEngine, PromptComposer, tools, templates de negócio
  whatsapp/   Cloud API, webhook (assinatura/parse), janela de 24h
  integrations/ Storage (local/S3/R2), calendário (Google/mock), transcrição de áudio
docs/         Arquitetura, WhatsApp, agente, multi-tenancy, segurança, deploy, onboarding
```

## Documentação

- [Plano técnico e estrutura](docs/TECHNICAL_PLAN.md)
- [Decisões arquiteturais](DECISIONS.md)
- [Validação local e testes](docs/VALIDATION.md)
- [Arquitetura](docs/ARCHITECTURE.md) e [isolamento multiempresa](docs/MULTITENANCY.md)
- [WhatsApp oficial](docs/WHATSAPP.md) e [agente de IA](docs/AI_AGENT.md)
- [Segurança](docs/SECURITY.md), [deploy](docs/DEPLOYMENT.md) e [onboarding](docs/ONBOARDING_COMPANY.md)
- [Diagnóstico e recuperação de incidentes](docs/INCIDENTS.md)
- [Proposta pendente para contabilização de custos](docs/COST_ACCOUNTING_PLAN.md)
- [Estado real, limitações e próximos passos](PROGRESS.md)
