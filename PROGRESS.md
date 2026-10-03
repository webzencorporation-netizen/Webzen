# PROGRESS

> Fonte de verdade do estado do projeto. Atualize ao fim de cada fase/sessão.
> Última atualização: 2026-09-29 — IA real via Meta Model API (Muse Spark 1.3) integrada e homologada; Anthropic segue disponível, mas bloqueada por créditos na conta

## Fase atual

**MVP existente validado localmente; etapa atual: confiabilidade e preparação de produção.** O registro anterior parou na Fase 1, mas os commits até `a1a8227` já contêm backend e painel. A retomada preservou esses módulos e as alterações locais recebidas. O plano técnico não detalha as fases 2–14; não atribuímos números novos sem esse histórico.

A pendência concreta da Fase 1 — validar API, worker, painel e testes de integração — foi concluída nesta retomada. Isso não equivale à homologação de produção ou dos serviços externos.

## Concluído

- **FASE 0 — Investigação**
  - Repositório vazio inspecionado; git inicializado.
  - Documentação atual consultada: Anthropic (modelos, tool use, caching, refusal fallback), Meta WhatsApp Cloud API (webhooks, assinatura, janela de 24h, preços por mensagem, Graph API v25.0), Prisma 7.
  - `DECISIONS.md` (D-001…D-015) e `docs/TECHNICAL_PLAN.md`.
- **FASE 1 — Fundação implementada**
  - Monorepo pnpm, TS 6, ESLint 10 + Prettier, tsconfig base.
  - `packages/config` (env validado com Zod + regras de produção que proíbem mocks).
  - `packages/shared` (enums, erros classificados, RBAC por permissões).
  - `packages/database` (schema Prisma completo, migração inicial com busca full-text, client com escopo de tenant + testes).
  - `docker-compose.yml` + `pnpm services:local` (Postgres/Redis sem Docker).
- **Implementação existente identificada na retomada**
  - API Fastify, sessões, CSRF, RBAC, modo suporte auditado e isolamento multiempresa.
  - WhatsApp oficial/mock: assinatura de webhook, deduplicação, filas, mídia, status e janela de 24h.
  - Worker BullMQ; engine Claude/mock, buffer, tools, templates por segmento, memória, conhecimento, métricas e custos.
  - CRM, agenda, catálogo, equipe, automações, integrações, privacidade, notificações e plataforma administrativa.
  - Seed Clínica Demo; painel Next.js de empresa e plataforma; onboarding e testes E2E já iniciados.
- **Etapa de diagnóstico e qualidade desta retomada**
  - Documentação, estrutura completa, histórico, `git status` e `git diff` inspecionados antes das alterações.
  - Corrigidos: seleção de arquivos do ESLint, console do seed, tipagem do setup E2E e coleta indevida de Playwright pelo Vitest.
  - Scripts dos pacotes sem suíte própria aceitam zero testes explicitamente; isso não representa cobertura desses pacotes.
  - Corrigido `.gitignore`: os quatro arquivos já existentes em `packages/integrations/src/storage` não podem ser excluídos do versionamento.
  - `pnpm lint` e `pnpm typecheck`: passaram.
  - `pnpm test`: **107 testes passaram** (61 unitários + 46 de integração com PostgreSQL).
- **Etapa de validação integrada concluída**
  - `pnpm test:e2e`: **7 cenários passaram** (6 desktop + 1 mobile) com API, worker BullMQ e painel reais, usando providers externos simulados.
  - Corrigidos o seletor ambíguo do alerta de login e a execução indevida do cenário mobile no desktop.
  - Portas e recursos E2E configuráveis; comandos Node diretos e SIGTERM corrigem servidores órfãos causados por `pnpm exec` no pnpm 12.
  - Revisão independente detectou seed E2E dependente de credenciais do shell. Falha reproduzida; fixtures compartilhadas e seed explícito corrigidos. A suíte completa passou mesmo com `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` divergentes no ambiente.
  - `pnpm build`: API, worker e painel aprovados. Dependências externas dos bundles declaradas também na API, com lockfile atualizado sem trocar as versões adotadas.
  - `pnpm test:build`: ambos os entrypoints carregam e recusam mocks em produção; antes da correção, o teste reproduziu `ERR_MODULE_NOT_FOUND`.
  - Smoke de inicialização: API compilada respondeu `200 {"status":"ready"}`; worker compilado iniciou. Processos de smoke e E2E encerrados ao final.
  - `README.md` aponta para documentação existente; instruções de teste em `docs/VALIDATION.md`; decisões D-016/D-017 registradas.
- **Documentação operacional concluída**
  - Sete guias: arquitetura, multi-tenancy, WhatsApp, agente, segurança, deploy e onboarding; README atualizado com links.
  - Conteúdo confrontado com código, com limitações explícitas de recuperação, concorrência, custos e retenção. Fontes oficiais consultadas nos guias de providers.
  - Links locais conferidos; lint/typecheck aprovados; os **107 testes** existentes passaram novamente.
  - Credenciais externas ausentes: homologação real permanece pendente, sem bloquear melhorias locais.

- **Recuperação de webhooks e ingestão concluída**
  - Webhooks persistidos `RECEIVED`/`PROCESSING` reenfileiram na reentrega; a ingestão grava seus efeitos/outbox numa transação serializável com tenant scope e retries limitados de conflito.
  - Reexecução recupera jobs pendentes sem duplicar mensagens, mídia, leads, métricas ou contadores; entradas já tratadas não disparam nova resposta.
  - Nove testes novos aprovados; regressões reproduzidas antes da correção. Fluxos WhatsApp/IA e isolamento passaram, assim como lint/typecheck. Revisão independente confirmou o escopo da transação e explicitou o limite de jobs falhos esgotados (D-018).
- **Bootstrap, CI e cobertura inicial de regras concluídos**
  - CLI para o primeiro `PLATFORM_OWNER`, sem seed demo, com segredo explícito, Argon2, lock transacional e auditoria; 14 testes aprovados, incluindo corrida e rollback (D-019).
  - Build/smoke agora incluem o bootstrap, além de API/worker; três bundles validados. Workflow CI preparado e validado localmente; execução no GitHub pendente.
  - Configuração: 26 testes de env/provedores; regras compartilhadas: 29 testes de agenda/fusos/permissões. Removido `--passWithNoTests` desses dois pacotes.
  - Corrigida pausa fora do expediente que ampliava disponibilidade. Schema recusa pausas inválidas; cálculo também limita dados legados ao expediente. RED/GREEN observado e checks dos pacotes aprovados.

- **Envio e interrupção do agente concluídos**
  - `lastInboundAt` usa timestamp original (futuro limitado à ingestão); entradas fora de ordem não fazem preview/última interação regredirem.
  - Worker revalida janela e opt-out antes do envio; bloqueios locais ficam visíveis como `send_blocked`, sem consumo de envio.
  - Sete testes novos de mensageria aprovados após cinco regressões reproduzidas; subset de quatro suítes WhatsApp/IA/recuperação passou (32 testes). Lint e typecheck completos aprovados.
  - Runner relê estado e entradas após a chamada de IA: pausa/humano/emergência/fechamento/exclusão/opt-out impedem publicação ou fallback tardio, preservando registros do turno e posse humana. 24 cenários novos + 10 fluxos existentes passaram; checks API aprovados.
  - Requests/tools em andamento não são cancelados. Mensagens já enfileiradas não são automaticamente retiradas por pausa; a janela entre checagem e publicação é uma limitação registrada.

- **Recuperação após envio e mídia concluída**
  - Erros locais após aceite do WhatsApp não convertem a mensagem em `FAILED`. O ID externo/aceite persistido impede novo envio nos retries; consumo e outbox são gravados juntos e recuperados, inclusive após status avançar para `DELIVERED`.
  - Mídias finalizadas recuperam agendamento pendente sem repetir download/transcrição; mensagens já tratadas não agendam nova resposta.
  - Cinco testes novos aprovados, com regressões observadas antes da correção, concorrência e classificação de erros. Subset de envio/IA aprovado; lint/typecheck completos passaram.
  - A incerteza entre aceite externo e persistência do ID permanece: não existe transação com o provider nem garantia de envio exatamente uma vez.

- **Senha obrigatória e segurança E2E concluídas**
  - API recusa operações protegidas de sessões provisórias até a troca da senha; allowlist explícita de login/me/troca/logout, inclusive bloqueio de switch/suporte/OAuth. Nove testes novos de API aprovados.
  - Modal existente também funciona sem empresa; troca invalida consultas protegidas para recuperar dados que receberam 403. Dois testes de navegador observaram RED/GREEN.
  - Setup E2E valida destino antes de conectar, remove DROP FORCE e prepara banco/migração/seed antes de API/worker/painel; 23 testes unitários web aprovados.
  - Suíte Playwright consolidada: **9 cenários passaram** (sete fluxos existentes + dois cenários de senha com API simulada); servidores próprios foram encerrados.
- **Cobertura de integrações concluída**
  - 58 testes de storage local/memória, STT, calendário e OAuth com HTTP simulado; todos aprovados, sem rede externa. Nenhum pacote de testes depende mais de `--passWithNoTests`.
  - Google freeBusy recusa resposta incompleta, erro por calendário e intervalos inválidos; não interpreta falha como agenda livre. PATCH/POST/consulta de disponibilidade recusam 404; GET individual preserva ausência e DELETE permanece idempotente.
  - Lint/typecheck dos pacotes aprovados; novo build consolidado de API/worker/bootstrap/painel e smoke dos três bundles passaram. Homologação externa permanece pendente.

- **Regressões consolidadas corrigidas**
  - Teste de equipe troca a senha temporária antes de exercer permissões; autenticação/painel passaram (22 testes).
  - Retry transacional reconhece o `DriverAdapterError` no COMMIT do Prisma 7, além de P2034; oito testes de classificação novos e subset de recuperação concorrente passaram. Pacote database: 38 testes; lint/typecheck completos aprovados.
- **Lease renovável do agente concluída**
  - Redis renova TTL por token, com conexão dedicada, prazo monotônico e comandos limitados; perda de posse bloqueia resposta/fallback, novas tools e primeira chamada de IA ainda não iniciada (D-021).
  - 56 testes de lease/IA aprovados, incluindo socket TCP silencioso com ioredis real. Smoke com Redis real comprovou renovação além do TTL, contenção, liberação e preservação do token sucessor.
  - Revisão independente encontrou início de IA após perda durante preparação de contexto; regressão reproduzida e corrigida. Não há fencing com banco ou cancelamento de trabalho já em voo.
- **Storage e recuperação de exclusão concluídos**
  - 18 testes S3 com SDK simulado; integrações: 76 testes aprovados. `exists()` só converte 404 em ausência e propaga erros de autenticação/limite/servidor/rede. Transporte e políticas reais ainda não homologados.
  - Exclusões preservam referências quando storage falha; retenção cobre mídias recentes de mensagens antigas, continua outras empresas e registra falha agregada (D-022).
  - Oito cenários de limpeza passaram, incluindo exclusão parcial seguida de retry e isolamento por empresa. Lint/typecheck completos aprovados; limites de concorrência/órfãos anteriores documentados.
- **Estado da empresa no atendimento concluído**
  - `SUSPENDED`/`CANCELLED` agora bloqueiam novos turnos/resumos automáticos e novos envios, além do painel; respostas/fallbacks tardios são descartados, com entradas e consumo preservados (D-023).
  - Aceites já persistidos continuam reparando consumo/outbox; `ONBOARDING`, `enabled`, teste manual explícito e resumo já em voo são preservados. Não é parada global de jobs nem cancelamento de trabalho externo.
  - 19 testes novos aprovados; subset integrado de seis suítes passou (71 testes antes dos dois últimos casos). Revisão independente sem bloqueios; lint/typecheck API aprovados.
- **Preparação da próxima etapa**
  - [Roteiro de incidentes](docs/INCIDENTS.md) para entradas, envios incertos, lease e exclusão; controles e limites conferidos no código.
  - [Plano de custos](docs/COST_ACCOUNTING_PLAN.md) descreve proposta de migração/contratos/testes para custo desconhecido, uso por modelo e erros parciais. Não foi implementado nem altera estimativas existentes.

- **Retomada após trabalho paralelo (Codex) e revisão do provider Anthropic concluídas**
  - Estado herdado revalidado antes de alterar: lint, typecheck, **392 testes**, build e `test:build` aprovados (PostgreSQL/Redis via `pnpm services:local`).
  - Provider conferido com a documentação oficial atual (modelos, preços, refusals/fallback). Modelos com fallback, beta `-2026-07-01`, effort e eco do conteúdo já estavam corretos; os preços padrão conferem.
  - Corrigido: `usage.iterations` e `stop_details` eram descartados. Agora `attempts`/`refusal` chegam ao engine; o runner grava a categoria da recusa e registra fallback/recusa em log (D-025). A distribuição de custo por tentativa continua no plano de custos.
  - Composição dos providers: provider real incompleto não é mais trocado por mock/local, e produção recusa simulação mesmo sem a validação do env. As sete regressões foram reproduzidas antes da correção.
  - Primeiros testes do provider real: 18 de contrato (SDK real contra HTTP local), cobrindo request, fallback, sticky, recusas, eco no loop e erros 400–529/conexão. Também foram adicionados 5 testes da homologação, 2 do engine, 1 do fluxo integrado e 9 da composição.
  - `pnpm homolog:anthropic [--cache]` preparado para a credencial real; `.env.example`, `docs/AI_AGENT.md` e o plano de custos foram atualizados.
  - Validação: lint, typecheck e **427 testes** aprovados.
  - **Bloqueio:** sem `ANTHROPIC_API_KEY` nem perfil de credencial nesta máquina, portanto sem homologação real. Para executar, configure a chave no `.env` e rode `pnpm homolog:anthropic --cache`.

- **Revisão do provider WhatsApp Cloud API concluída (sem credenciais)**
  - Conferido com a documentação oficial atual: BSUID/nomes de usuário, tabela de erros, changelog da Graph API e preços de mensagens sem template.
  - **Corrigida perda silenciosa:** mensagens sem telefone (usuários com nome de usuário) eram descartadas pelo parser; um contato sem `wa_id` descartava a alteração inteira. Agora ficam retidas (`message_without_phone`, `IGNORED` + payload + `ErrorLog`), e o BSUID é preservado nas demais (D-026). Cinco regressões foram reproduzidas antes da correção.
  - Retries incluem `131057`/`133004`; dez códigos que exigem ação têm orientação em português.
  - Primeiros testes do cliente Cloud API: payloads de texto/template/mídia/leitura, URL versionada, allowlist de mídia sem vazar token, erros Graph/rede e aceite sem ID. O pacote WhatsApp passou de 10 para **51 testes**, com mais 1 integrado de webhook.
  - `pnpm homolog:whatsapp` preparado; `.env.example` (`HOMOLOG_WA_*`, versão) e `docs/WHATSAPP.md` foram atualizados.
  - **Bloqueio:** sem token, número ou WABA de teste da Meta. Para executar, siga a etapa 1 da homologação em [WHATSAPP](docs/WHATSAPP.md) com `WHATSAPP_GRAPH_API_VERSION=v26.0`.

- **Revisão de Calendar, Storage e STT concluída (sem credenciais)**
  - S3: com `S3_ENDPOINT` (R2/MinIO/Ceph), checksums só quando exigidos. Os padrões do SDK ≥ 3.729 quebravam uploads nesses serviços; AWS S3 mantém as proteções (D-027).
  - Google: `invalid_grant`/ausência de refresh token viram erro de reautorização; a integração vai para `ERROR` com uma única notificação crítica. Integração em erro ou sem configuração OAuth na instalação recusa em vez de ser ignorada. Escopos e endpoints conferidos; escopo sensível e expiração de 7 dias no modo "Testing" documentados em [DEPLOYMENT](docs/DEPLOYMENT.md).
  - STT `openai-compatible`: multipart, extensão por MIME (OGG dos áudios do WhatsApp) e `whisper-1` padrão conferidos, sem alteração.
  - Testes: integrações 76 → **78**; API +3 cenários de autorização do Google. Regressões reproduzidas antes das correções.
  - **Bloqueio:** sem credenciais Google (OAuth client) e sem bucket S3/R2 de teste.

- **Correção de build do painel (bug real) concluída**
  - `pnpm build` do painel falhava com `TypeError` na página `global-error` quando `NODE_ENV=development` estava presente no `.env` (o build do Next.js precisa rodar em modo produção independente do `.env` do ambiente).
  - Corrigido `apps/web/package.json`: script `build` agora fixa `NODE_ENV=production` explicitamente. Build voltou a passar (API + 24 rotas do painel).
- **Homologação funcional dos fluxos existentes concluída (sem credenciais externas, `AI_PROVIDER=mock`/`WHATSAPP_PROVIDER=mock`)**
  - Reconfirmado do zero nesta sessão: `pnpm lint`, `pnpm typecheck` (8 pacotes), `pnpm build`, **474 testes** (config 26, shared 29, web 23, database 38, IA 46, WhatsApp 51, integrações 78, API 183), `pnpm test:build` (3 bundles) e **9 cenários E2E** — todos aprovados, sem regressão.
  - Fluxos com cobertura automatizada já exercitados pelas suítes acima (não re-testados manualmente): login, criação de empresa, onboarding, CRM kanban, inbox com handoff humano→IA e IA→humano, agente de IA em modo mock, exportação/exclusão LGPD.
  - Fluxos sem teste dedicado, testados manualmente via API (curl, sessão autenticada `dono@clinicademo.local`): **catálogo** (criação/listagem de serviço e produto), **contatos** (criação, listagem, edição — normalização de telefone confirmada), **agenda** (disponibilidade respeitando duração/conflitos, criação e listagem de agendamento, cancelamento), **métricas** (`overview`, `series` e `usage` com tokens/custo de IA já populados corretamente). Dados de teste criados foram removidos ao final (nenhum resíduo na base de desenvolvimento).
  - **Resultado: nenhum bug real encontrado.** Nenhuma funcionalidade existente foi redesenhada.
- **Fase 1 — Anthropic (revisão dos requisitos do usuário) conferida**
  - Os nove itens pedidos já estavam implementados pela revisão do provider desta mesma data (ver "Retomada após trabalho paralelo... revisão do provider Anthropic" acima, D-025): provider real revisado contra a documentação oficial atual; mock continua disponível via `AI_PROVIDER=mock`; produção recusa mock silenciosamente (`createProviders` lança erro); tratamento de rate limit/erro/indisponibilidade com classificação de retryable (`mapError` em `packages/ai/src/provider/anthropic.ts`); tokens de entrada/saída/cache e custo estimado são registrados (`UsageRecord`/`AgentRun`, `estimateCostUsd`) e expostos em `/api/app/metrics/usage` (confirmado populado na homologação funcional acima); `.env.example` documenta `ANTHROPIC_API_KEY`/`AI_PROVIDER`/`AI_DEFAULT_MODEL`; forma simples de testar a conexão existe tanto por script (`pnpm homolog:anthropic [--cache]`) quanto pelo painel (Agente de IA → Testar agente, usando o provider configurado no ambiente).
  - **Bloqueio inalterado:** sem `ANTHROPIC_API_KEY` real nesta máquina, a homologação com credencial paga (`pnpm homolog:anthropic --cache`) não pôde ser executada nesta sessão. Sem isso, a Fase 1 não pode ser declarada "testada" conforme exigido antes de avançar.

- **IA real via Meta Model API — Muse Spark 1.3 (2026-09-29, D-028)**
  - Motivo: a verificação de identidade da Anthropic impediu adicionar créditos; o responsável escolheu a IA oficial da Meta. A Llama API foi desativada em jul/2026; a oferta atual é a Meta Model API.
  - `AI_PROVIDER=meta` → `MetaModelProvider`: provider separado, sobre o formato Messages já usado (SDK Anthropic em `https://api.meta.ai`, Bearer, sem ler `ANTHROPIC_API_KEY`), `effort` sempre enviado e folga de raciocínio em `max_tokens`. Catálogo e modelo efetivo respeitam o provedor ativo; env recusa modelo de outro provedor; `muse-spark-1.3` na tabela de preços (1,25 / 0,15 cache / 4,25 por M).
  - `pnpm homolog:meta` **APROVADO** com a chave real: modelo e preço, conversa, effort low/medium/high, `thinking: disabled` recusado (esperado), tool calling completo, duas ferramentas no mesmo turno, limite de tokens, streaming, `tool_choice` (só `auto`), 401 e 404 não repetíveis. 429/5xx só nos testes de contrato. Consumo 3.144 in / 1.346 out, ~US$ 0,01.
  - Painel (Testar agente) com a API real: `search_services` + `update_lead_qualification`, preço correto (R$ 180,00), 3 etapas, US$ 0,024, 17,8 s.
  - Fluxo WhatsApp pelo simulador (mesma ingestão do webhook; `WHATSAPP_PROVIDER=mock`): worker executou `muse-spark-1.3`/`meta`, 3 tools (horário, catálogo, qualificação), resposta enviada pelo provider mock, US$ 0,019, 16,6 s. A Clínica Demo tinha `claude-opus-5` salvo e caiu corretamente no modelo padrão da Meta.
  - Chave somente no `.env` (ignorado): ausente de arquivos versionados/novos, histórico git, bundle `.next`, logs de API/worker/painel e respostas da API. Testes da API agora fixam modelo e esvaziam chaves reais (não dependem do `.env` local).

- **Qualidade das respostas com Muse Spark (2026-09-29)**
  - Conversa real do responsável às 3h mostrou autocorreção ("amanhã, digo, hoje"), confirmação repetitiva e concordância errada ("agendado sua limpeza").
  - Prompt: o contexto passa a trazer "Hoje/Amanhã/Próximos dias" calculados no fuso da empresa; regras de mensagem final revisada (sem autocorreção), português com concordância e confirmação em uma frase; ao concluir uma ação, só informação dos dados da empresa ou das ferramentas (o modelo tinha inventado "chegue 10 minutos antes").
  - Bug do painel: o rewrite do Next corta em 30 s (`proxyTimeout`), e o Testar agente devolvia 500 em turnos longos do Muse Spark. Ajustado para 180 s (= lease do turno). O WhatsApp (worker) não era afetado.
  - Mesma conversa com a API real depois do ajuste: sem autocorreção, confirmação "Fechado: limpeza de pele hoje, terça 29/09, às 09:00. Posso confirmar?", agendamento confirmado só com dados reais. Tempo por turno: `medium` ≈ 27 s / 25 s / ~55 s; `low` ≈ 20 s / 13–17 s / 16–24 s, com qualidade equivalente e custo semelhante (~US$ 0,02–0,03 por turno). A Clínica Demo foi mantida em `medium`.

- **Agenda sem reserva dupla (2026-09-29, D-029)**
  - Bug reproduzido por teste: 5 pedidos simultâneos para o mesmo horário reservavam 4; duas remarcações simultâneas passavam; reativar um cancelado ocupava horário já tomado.
  - Correção: "verificar e gravar" em transação com advisory lock por empresa (criação, remarcação e reativação). A consulta ao Google fica fora do lock. O encaixe manual (`enforceAvailability: false`) é preservado.
  - 4 testes novos em `apps/api/test/calendar.test.ts`. Lint, typecheck e suíte completa verdes (506 testes).

- **Relatório de consumo da IA e fuso do banco (2026-09-29, D-030/D-031)**
  - `GET /api/platform/usage/breakdown` e `GET /api/app/metrics/usage/breakdown`: totais, por dia, por modelo/provedor e (plataforma) por cliente; chamadas, tokens, custo, execuções, taxa de erro e latência média; período livre (padrão mês corrente).
  - Bug encontrado pelo teste de virada de dia: o adapter-pg gravava datas deslocadas quando o Postgres não está em UTC (local herdava `America/Santiago`). Sessão agora sempre em UTC; teste reproduz com o banco configurado fora de UTC. Dados locais antigos ficam deslocados — reseedar o banco de desenvolvimento.
  - 5 testes novos (agrupamento, fuso, isolamento entre clientes, validação de período, permissão, fuso do banco). Lint, typecheck e suíte completa verdes (511 testes).

- **Recuperação de respostas travadas (2026-09-29, D-032)**
  - Job `agent.recover-stalled` a cada 5 min: reagenda `agent.reply` para conversas em modo IA com mensagem do cliente pendente entre 10 min e 6 h; depois de 3 execuções sem resolver, passa para humano (nota + notificação) e para de tentar.
  - Mensagens de saída com falha continuam sem reenvio automático (D-020).
  - 4 testes novos (recuperação ponta a ponta, filtros, limite com handoff único, várias empresas). Lint, typecheck e suíte completa verdes (515 testes).

- **Custo do WhatsApp nos relatórios (2026-09-29, D-033)**
  - A cobrança informada pela Meta nos status é gravada por mensagem (migração `message_whatsapp_pricing`: 3 colunas opcionais + índice) e somada ao relatório de consumo por dia, cliente e categoria.
  - Preço: referência oficial (US$ 0,0068 service/utility/authentication, Brasil) + `WHATSAPP_PRICE_USD`; categorias sem preço (marketing) ficam sem custo, contadas à parte.
  - 3 testes novos (gravação única e fora de ordem, soma por categoria com e sem preço + isolamento, validação do env). Lint, typecheck e suíte completa verdes (518 testes).

- **Auditoria e hardening de segurança (2026-09-30, D-034)**
  - Mapeamento completo (155 rotas, auth, RBAC, tenant, webhooks, SSRF, SQL cru, uploads, IA, dependências, histórico git). Nada crítico; 2 ALTAS, 3 MÉDIAS e 2 BAIXAS confirmadas por teste e corrigidas: IP forjável (`trustProxy`), login sem limite por conta, "Testar agente" sem limite/orçamento, redação de logs rasa, painel sem CSP/HSTS, fixação de sessão, dependências do CLI do Prisma.
  - Inventário de endpoints com teste de política; verificador de segredos (CI + pré-commit) e `pnpm audit` no CI. CSP validada com build de produção no navegador (sem violações).
  - 37 testes de segurança novos; suíte completa verde (555 testes). `pnpm audit`: nenhuma vulnerabilidade conhecida.
  - Pendentes documentados: MFA para administradores, papel de banco restrito em produção, expiração de sessão por inatividade.

## Em andamento

- Nada em andamento. Pendente de decisão do responsável: conectar um número real no WhatsApp Cloud (`WHATSAPP_PROVIDER=cloud`) para a homologação ponta a ponta com a Meta.

## Próximos passos

1. Homologar com credenciais reais, nesta ordem: cenários de atendimento de [AI_AGENT](docs/AI_AGENT.md) com Muse Spark (qualidade das respostas, agenda, handoff; avaliar `effort=low` para latência) → `pnpm homolog:whatsapp` em `v26.0` → cenários de [WHATSAPP](docs/WHATSAPP.md) → Google (app OAuth publicado) e bucket S3/R2. Anthropic (`pnpm homolog:anthropic --cache`) quando houver créditos.
2. ~~Confirmar a primeira execução do workflow no GitHub~~ — concluído: CI verde em 2026-09-28 (`webzencorporation-netizen/Webzen`, execução 36502894539).
3. Implementar [contabilização de custos desconhecidos](docs/COST_ACCOUNTING_PLAN.md) em etapa própria: proposta preparada, sem migração ou mudança de comportamento nesta sessão. Ampliar expurgo/reconciliação de storage conforme limites documentados.
4. Preparar replay administrativo/reconciliação de jobs esgotados sem duplicar efeitos externos.
5. **Decisão de produto pendente — BSUID no WhatsApp:** hoje, clientes com nome de usuário e sem interação recente não recebem resposta automática; as mensagens ficam retidas. Suporte completo exige migração de `Contact` (telefone opcional + BSUID único por empresa), envio por `recipient`, mescla quando o telefone aparecer, troca de número (`user_id_update`) e reprocessamento dos eventos retidos. Ver D-026 e [WHATSAPP](docs/WHATSAPP.md).
6. **Custo da Meta a partir de 2026-10-01:** já gravado e somado aos relatórios (D-033). Pendente: conferir a tabela oficial vigente em 2026-10-01 e configurar `WHATSAPP_PRICE_USD` (principalmente marketing); decidir se o custo WhatsApp entra em limites e planos.

## Problemas conhecidos

- `prisma migrate dev` pode travar em terminal não interativo; use `prisma migrate dev --create-only` + `prisma migrate deploy`.
- Os testes de integração exigem PostgreSQL disponível (`pnpm services:local` ou Docker); o fallback automático mencionado em D-014 ainda não foi implementado.
- D-007 foi atualizado pela D-021: Redis com lease renovável, sem fencing transacional. Requests/tools já em voo e mensagens já enfileiradas não são cancelados automaticamente; permanecem janelas entre checagem e efeitos.
- Recuperação de entrada agora depende de reentrega/retry; ainda não há reconciliador global nem replay administrativo para jobs esgotados. Não há garantia de envio externo exatamente uma vez. Outros limites de concorrência, custos e retenção estão nos guias.
- Há avisos de depreciação de Fastify (`disableRequestLogging`) e pg (consultas concorrentes no mesmo client), sem falhas na suíte atual.
- S3 tem testes de contrato simulados; homologação real permanece pendente. O storage local não protege contra symlinks criados dentro de sua raiz por outro processo; produção já exige S3. Exclusão mantém referências em falhas, mas ainda não reconcilia uploads concorrentes, órfãos anteriores ou cópias externas.
- As portas E2E padrão 4100/3100 já estavam ocupadas nesta máquina. A retomada usa 4200/3200, banco `botsaas_e2e_resume`, Redis DB 6 e build `.next-e2e/resume`, preservando os serviços anteriores.

## Decisões arquiteturais

Ver `DECISIONS.md`.
