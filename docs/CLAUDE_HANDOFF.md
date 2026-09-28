# Passagem da retomada para o Claude

Atualizado em 27/09/2026. Este documento descreve o trabalho desta sessão e o estado a preservar. O usuário pediu encerrar após concluir a correção de consumo dos resumos; não iniciar outra etapa automaticamente nesta sessão.

## Contexto e instrução de continuidade

O repositório é `/home/roberto/BotsSass`, com HEAD `a1a8227` durante a retomada. Já havia backend, painel e muitas alterações locais não commitadas, inclusive telas e testes E2E. O projeto não foi reiniciado e os módulos existentes não foram recriados. Não atribua todos os arquivos modificados/não rastreados à sessão: parte deles já estava assim quando o trabalho começou.

Antes de continuar, leia [PROGRESS.md](../PROGRESS.md), [DECISIONS.md](../DECISIONS.md), [README.md](../README.md) e os guias em `docs`; inspecione `git status`, `git diff` e arquivos não rastreados. Preserve o trabalho local. Não execute reset/clean nem substitua o projeto por um scaffold.

A arquitetura continua uma plataforma multiempresa, banco/schema compartilhados, isolamento por `companyId`, Meta WhatsApp oficial, Claude via API, painel administrativo, CRM, agenda, conhecimento, memória, tools, atendimento humano, templates, métricas e custos. Stack existente: pnpm 12, TypeScript 6, Fastify 5, Prisma 7/adapter-pg, PostgreSQL, Redis/BullMQ, Next 16 e React 19. Não houve nova migração de schema nesta sessão.

Não houve commit, push, PR, deploy ou envio real de WhatsApp. Não foram adicionados secrets reais. A validação usou providers simulados, PostgreSQL/Redis locais de testes e navegador real. Homologação externa não foi feita.

## Mudanças realizadas

### 1. Retomada, lint, tipos e estrutura de testes

- Documentação, estrutura, histórico, estado Git e diff foram examinados antes das modificações.
- `PROGRESS.md` estava desatualizado na Fase 1; passou a registrar o MVP já existente e a fase real de confiabilidade/preparação de produção.
- `.gitignore` foi corrigido de `storage/` para diretórios específicos de uploads. Quatro fontes já existentes em `packages/integrations/src/storage` estavam ocultos pelo ignore; agora aparecem no Git e precisam entrar no versionamento futuro.
- ESLint deixa de percorrer builds/resultados E2E e permite o uso de console no seed existente.
- Vitest do web coleta apenas `src`/`test`, sem executar arquivos Playwright. Todos os pacotes com testes agora têm suíte própria, sem depender de `--passWithNoTests`.
- Tipagem e seletores dos testes existentes foram corrigidos. Mudanças locais anteriores de frontend foram preservadas.

Arquivos principais: `.gitignore`, `eslint.config.mjs`, `apps/web/vitest.config.ts`, scripts dos manifests e novas suítes nos pacotes.

### 2. E2E isolado e seguro

- Configuração de portas, banco, Redis e diretório de build por variáveis E2E.
- Fixtures fixam credenciais demo; variáveis `SEED_ADMIN_*` do shell não alteram o seed dos testes.
- Providers externos e storage dos testes são explicitamente mock/local.
- Processo direto via Node e encerramento SIGTERM corrigem servidores órfãos que `pnpm exec` deixava em outro grupo.
- Desktop não executa novamente o cenário mobile; alerta de login não confunde o anunciador do Next.
- Destino PostgreSQL é validado antes de conectar: família de nomes `botsaas_*e2e*` com segmentos validados, ASCII e até 63 caracteres, sem query/fragmento. Reset não usa `DROP ... FORCE` e não encerra conexões existentes.
- Banco/migração/seed são preparados pelo primeiro processo antes da API; worker e Next iniciam depois. `globalSetup` não é usado como hook Playwright porque ocorreria tarde demais na versão adotada.
- Nove cenários: sete fluxos completos já existentes e dois de troca de senha com API simulada. O enforcement real de senha é coberto nos testes API.

Arquivos: `apps/web/playwright.config.ts`, `apps/web/e2e/*`, `apps/web/test/e2e-setup.test.ts`.

### 3. Build e bootstrap do primeiro proprietário

- Dependências npm externas dos bundles foram declaradas também em `apps/api/package.json`, nas versões já adotadas; lockfile atualizado. Antes, o build compilava, mas o runtime falhava com `ERR_MODULE_NOT_FOUND`.
- Build inclui API, worker e bootstrap do proprietário. `pnpm test:build` verifica os três imports e suas recusas de configuração inválida, sem acessar providers.
- CLI `bootstrap:owner`/`start:bootstrap-owner` cria somente o primeiro `PLATFORM_OWNER`, com banco/e-mail/nome/senha explícitos, Argon2, advisory lock transacional e auditoria atômica.
- Não usa seed demo, senha por argumento ou inicialização de providers. Recusa administrador já existente, mesmo inativo, e não promove/substitui usuário existente. Não é recuperação de acesso.

Arquivos: `apps/api/scripts/build.ts`, `check-build.ts`, `src/bootstrap-owner.ts`, `src/modules/platform/bootstrap-owner.ts`; testes de bootstrap e scripts root/API.

### 4. Webhooks e entrada transacional

- Ingestão grava contato, conversa, mensagem, mídia, métricas, lead e outbox numa transação serializável com client de tenant.
- `recordDomainEvent` separa persistência da publicação na fila; jobs são publicados depois do commit.
- Retry/reentrega recupera efeitos pendentes sem duplicar contadores, mensagens ou leads; entrada já tratada não provoca nova resposta.
- Webhooks `RECEIVED`/`PROCESSING` recuperam enqueue usando o mesmo ID. Jobs falhos esgotados não são reabertos automaticamente.
- Conflitos reconhecem tanto `P2034` quanto `DriverAdapterError` do COMMIT do adapter-pg (`TransactionWriteConflict`, SQLSTATE `40001`/`40P01`), com retry limitado.
- Timestamp original da mensagem governa a janela; futuro é limitado à ingestão. Eventos fora de ordem não fazem preview, última mensagem ou interação regredirem.

Arquivos: `context.ts`, `lib/events.ts`, `messaging/inbound.ts`, `messaging/conversations.ts`, `webhooks/service.ts`, helpers de features e `packages/database/src/utils.ts`/exports.

### 5. Envio, consentimento e recuperação após aceite

- Worker revalida opt-out e janela de 24 horas antes do provider, inclusive quando a fila atrasou.
- Bloqueio local fica como `FAILED`/`send_blocked`, sem envio ou consumo de mensagem enviada. Template não reabre a janela por si só.
- Falha local após aceite externo não transforma um envio aceito em falha de provider.
- Se `externalId` e `sentAt` já existem, retry completa consumo/outbox sem reenviar, mesmo após `DELIVERED`/`READ`.
- Consumo e outbox de envio são gravados juntos com recuperação concorrente.
- Mídia já finalizada pode recuperar o agendamento da IA sem novo download/transcrição; entrada tratada não reagenda.

Arquivos: `messaging/outbound.ts`, `messaging/media.ts`; testes `messaging-safety`, `messaging-effects`, `webhook-recovery`.

### 6. Interrupção do agente e lease renovável

- Runner relê estado e entradas após a IA. Pausa, humano, emergência, fechamento, exclusão, opt-out e entradas já tratadas impedem resposta/fallback tardios.
- Devolver ao agente invalida o resultado antigo quando as entradas foram marcadas tratadas.
- Lock Redis de 180 segundos agora renova a cada 60 segundos por token/Lua.
- Conexão dedicada, sem retries/fila offline, timeout de comando de até dois segundos, prazo monotônico e detecção de perda/fechamento evitam manter posse fictícia.
- Lease perdida impede novos efeitos de controle/publicação e tools ainda não iniciadas. Contexto/mídia e criação do AgentRun são revalidados antes da primeira chamada paga.
- Registro e consumo que o engine retorna permanecem; perda de lease não é convertida em fallback/falha operacional da IA.
- Testes incluem relógio/transporte simulados, socket TCP silencioso com ioredis real e smoke com Redis real.

Arquivos: `lib/locks.ts`, `agent/runner.ts`; testes `agent-interruption`, `agent-lease`, `locks`, `locks-socket`.

### 7. Empresa suspensa/cancelada

- `SUSPENDED`/`CANCELLED` agora bloqueiam novos turnos automáticos, resumos e novos envios; anteriormente bloqueavam apenas o painel.
- Estado é revisto antes do provider e após resultado/erro da IA. Entrada permanece pendente; resposta/fallback tardios são descartados.
- Aceite de envio já persistido continua reparando métricas/outbox.
- `enabled` não é alterado; reativação não desfaz pausa manual. `ONBOARDING` e teste manual explícito via suporte mantêm comportamento.
- Reativar não reproduz backlog nem reabre envios `FAILED`.

Arquivos: `lib/company-record.ts`, `agent/runner.ts`, `agent/summary.ts`, `messaging/outbound.ts`; 19 testes em `company-execution-status.test.ts`.

### 8. Senha temporária obrigatória

- API bloqueia rotas protegidas `/api/*` para `mustChangePassword`, com allowlist por método de login, perfil próprio, troca e logout.
- Switch de empresa, suporte e callback OAuth não contornam a regra; health/webhook públicos são preservados.
- Troca invalida queries protegidas do painel e recupera dados que receberam 403.
- Conta sem empresa também tem menu/modal de senha e saída.
- Teste antigo de equipe foi ajustado para trocar a senha provisória antes de operar, sem relaxar a proteção.

Arquivos: `plugins/auth.ts`, `change-password-dialog.tsx`, `company-shell.tsx`, testes API de senha e E2E `password-change.spec.ts`.

### 9. Regras de agenda e integrações

- Pausa fora do expediente não amplia mais a disponibilidade: schema valida duração/contenção e cálculo limita dados legados.
- Google freeBusy recusa resposta incompleta, erro por calendário ou intervalo inválido, sem transformar erro em agenda livre.
- Google 404 só é tolerado onde corresponde a ausência/idempotência (GET individual/DELETE); criação, atualização e disponibilidade propagam erro.
- S3 `exists()` só converte 404 do SDK em ausência; autenticação, limite, servidor e rede propagam erro.
- Cobertura de configuração, horários/fusos/permissões, storage local/memória/S3, STT, calendário e OAuth, sem rede externa.

Arquivos: `packages/shared/src/business-hours.ts`, `packages/integrations/src/calendar/google.ts`, `storage/s3.ts` e novos testes dos pacotes.

### 10. Exclusão e retenção de arquivos

- Contato/conversa/documento remove objetos conhecidos antes do registro. Falha no storage preserva referências para repetir a exclusão.
- Retenção inclui mídia recente ligada a mensagem antiga que seria apagada por cascade.
- Erro em uma empresa não impede processar as demais; job termina com erro agregado após a limpeza técnica.
- Deletes idempotentes permitem retry após remoção parcial. Não há restauração dos arquivos já removidos.

Arquivos: services de contatos/conversas, knowledge/documents, maintenance/service; oito cenários em `storage-cleanup.test.ts`.

### 11. Última correção: consumo do resumo

- `UsageRecord` é gravado assim que o provider retorna métricas, antes de descartar texto vazio ou gravar o resumo.
- Resposta vazia/whitespace/recusa sem texto e erro posterior de persistência não apagam o consumo observado.
- Erro do provider sem métricas não recebe consumo inventado. Preços, schema e contagem existente não foram alterados.
- Seis testes novos, com quatro regressões reproduzidas antes da correção; subset de resumo/IA/suspensão passou com 35 testes.

Arquivos: `agent/summary.ts` e `summary-usage.test.ts`.

### 12. CI, documentação e decisões

- `.github/workflows/ci.yml`: checks, PostgreSQL/Redis descartáveis, testes, build/smoke e Playwright. Instalação frozen-lockfile, permissões somente leitura, sem credenciais reais/deploy, traces de falha. A primeira execução no GitHub ainda não foi confirmada.
- README e guias: arquitetura, multi-tenancy, WhatsApp, IA, segurança, deploy, onboarding, validação e incidentes.
- `PROGRESS.md` registra etapas, resultados e pendências; D-016 a D-024 documentam runtime, testes, ingestão, bootstrap, envio, lease, exclusão, suspensão e consumo de resumo.
- [COST_ACCOUNTING_PLAN.md](COST_ACCOUNTING_PLAN.md) é proposta pendente, não implementação de custos nullable. Inclui migração, UI, budgets, modelos diferentes, erros parciais e legado ambíguo.

## Validação e execução local

O resultado consolidado final está em [PROGRESS.md](../PROGRESS.md). Foram executados lint, typecheck, testes unitários/integrados, Playwright desktop/mobile, build e smoke de bundles. O navegador usa API/worker/painel reais e providers externos simulados.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:build

E2E_API_PORT=4200 \
E2E_WEB_PORT=3200 \
E2E_DATABASE_URL=postgresql://botsaas:botsaas@localhost:5432/botsaas_e2e_resume \
E2E_REDIS_URL=redis://localhost:6379/6 \
E2E_NEXT_DIST_DIR=.next-e2e/resume \
pnpm test:e2e
```

Esses bancos são descartáveis e exclusivos de teste. A suíte API usa `botsaas_test`; trabalhos paralelos usaram outro banco exclusivo `botsaas_test_bootstrap`. Não apontar esses comandos para produção. Serviços anteriores em outras portas foram preservados; os servidores iniciados pelos testes foram encerrados.

## Pendências e limites que o Claude precisa conhecer

1. **Custos:** modelo sem preço ainda pode gerar custo zero; turno com vários modelos usa o primeiro para o agregado. Erro numa iteração posterior ainda pode perder consumo parcial do engine. Mocks produzem tokens simulados que passam pela tabela atual. A correção completa exige a proposta própria; não inventar tarifas nem recalcular legado com preço atual.
2. **Providers reais:** Meta, Anthropic, S3 e Google não foram homologados; credenciais ausentes. Testes verdes com mocks não comprovam produção.
3. **Filas:** recuperação depende de retry/reentrega. Não há replay administrativo ou reconciliador global; job esgotado retido não reinicia com o mesmo ID.
4. **Envio externo:** não existe transação provider↔banco nem exactly-once. Aceite antes de persistir ID é uma janela de resultado incerto.
5. **Concorrência:** lease e releituras não são fencing com PostgreSQL. Tools/requests já em voo podem concluir; troca silenciosa de token é detectada na renovação. Pausar IA não retira todos os sends já enfileirados; suspensão da empresa bloqueia novos envios no worker.
6. **Suspensão:** não é parada global. Mídia/STT, calendário, conhecimento, recebimentos/status e manutenção continuam.
7. **Expurgo:** ainda há concorrência com uploads, órfãos anteriores, cópias externas/backups e retenção incompleta de memórias/resumos/previews. Storage local não se defende de symlinks criados por outro processo; produção exige S3.
8. **Infra/CI:** testes precisam de PostgreSQL/Redis iniciados; o fallback automático descrito originalmente em D-014 não existe. CI foi preparada/validada localmente, não executada no GitHub nesta sessão.
9. **Avisos:** depreciações de Fastify (`disableRequestLogging`) e pg (queries concorrentes no mesmo client) permanecem, sem falhar os checks.
10. **Git:** alterações seguem locais e não commitadas; incluir os fontes de storage antes de uma futura publicação. Não apagar trabalho preexistente nem assumir autoria de todo o dirty tree.

Próxima etapa recomendada: revisar o plano de custos e implementar de forma coerente entre schema, engine, relatórios, budgets e UI, com testes. Homologação real/CI e reconciliação de filas/storage seguem no acompanhamento. Não iniciar uma migração ampla como parte de uma simples correção pontual.
