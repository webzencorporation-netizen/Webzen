# Plano técnico

Resumo do plano de implementação. Estado real e próximos passos ficam em `PROGRESS.md`; decisões em `DECISIONS.md`.

## Arquitetura em uma frase

**Uma plataforma, muitas empresas, um núcleo de agente, vários templates, configuração por empresa** — monólito modular (API + worker + painel) sobre PostgreSQL e Redis.

```
Cliente final ─► WhatsApp ─► Meta Cloud API ─► POST /webhooks/whatsapp (API)
                                                    │ valida assinatura
                                                    │ deduplica (WebhookEvent)
                                                    │ identifica empresa (phone_number_id)
                                                    │ persiste mensagem
                                                    ▼
                                              fila BullMQ ──► worker
                                                               │ debounce/agrupamento
                                                               │ AgentEngine (Claude + tools)
                                                               │ MessagingProvider.send
                                                               ▼
                                                     WhatsApp do cliente

Equipe da empresa ─► Painel Next.js ─► /api/* (mesma origem, cookie de sessão) ─► API
```

## Estrutura

| Caminho | Responsabilidade |
|---|---|
| `apps/api/src/main.ts` | Servidor HTTP Fastify |
| `apps/api/src/worker.ts` | Processadores de fila (mensagens, agente, mídia, resumos, lembretes, automações) |
| `apps/api/src/modules/platform/*` | Área da plataforma (super admin) — usa `systemDb` |
| `apps/api/src/modules/company/*` | Painel da empresa — **só** client com escopo (`request.db`) |
| `apps/api/src/modules/auth` | Login, sessão, troca de empresa, modo suporte |
| `apps/api/src/modules/webhooks` | Webhooks externos (WhatsApp) |
| `apps/api/src/modules/agent` | Orquestração do agente (carrega contexto, persiste AgentRun, tools concretas) |
| `packages/ai` | `AIProvider`, `AgentEngine`, `PromptComposer`, `ToolRegistry`, templates de negócio, buffer |
| `packages/whatsapp` | `MessagingProvider` (Cloud API / mock), parser de webhook, assinatura, janela 24h |
| `packages/integrations` | `ObjectStorageProvider`, `CalendarProvider`, `SpeechToTextProvider` |
| `packages/database` | Prisma schema, migrações, client com escopo de tenant, seed, utilitários de teste |
| `packages/shared` | Enums, erros, RBAC, schemas Zod compartilhados com o painel |
| `packages/config` | Validação das variáveis de ambiente |
| `apps/web` | Painel (empresa + plataforma) |

## Ordem das fases

Conforme o briefing (FASE 0 → 14). Cada fase só é marcada como concluída após typecheck, lint e testes relacionados passarem, e o `PROGRESS.md` ser atualizado.
