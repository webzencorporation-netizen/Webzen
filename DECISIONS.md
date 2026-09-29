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

**Estado verificado em 2026-09-26:** o bootstrap automático da infraestrutura de testes ainda não existe. Hoje é preciso iniciar Docker ou `pnpm services:local`; o setup aplica migrações em `TEST_DATABASE_URL` (padrão `botsaas_test`). A automatização permanece pendente, sem mudar a opção de desenvolvimento sem Docker.

## D-015 — TypeScript 6.0

TypeScript 7 (port nativo) já é `latest`, mas `typescript-eslint` suporta até `<6.1`. Fixamos TS 6.0.x até o ecossistema acompanhar.

## D-016 — Dependências de execução dos bundles da API e worker

**Contexto:** o esbuild incorpora os pacotes internos TypeScript e mantém dependências npm externas (D-001). O pnpm resolve essas dependências a partir de `apps/api/dist`; declarar Prisma, SDK Anthropic, SDK S3 e pg somente nos pacotes internos permitia compilar, mas impedia iniciar o bundle (`ERR_MODULE_NOT_FOUND`).

**Decisão:** `apps/api/package.json` também declara as dependências externas usadas pelo código incorporado, nas mesmas versões já adotadas nos pacotes. O lockfile continua único; não há mudança de provider ou de arquitetura.

**Verificação:** após `pnpm build`, executar `pnpm test:build`. O teste carrega os dois entrypoints e exige que a validação de produção recuse mocks, sem conectar a infraestrutura. Isso detecta módulos ausentes antes de um deploy; não substitui testes de readiness nem homologação de providers reais.

## D-017 — Separação e ciclo de vida das suítes locais

**Contexto:** Vitest coletava testes Playwright, ESLint percorria `.next-e2e`, e `pnpm exec` no `webServer` deixava processos em grupos separados no pnpm 12, impedindo o teardown.

**Decisão:** Vitest do web coleta apenas `src` e `test`; Playwright executa os cenários de navegador e separa desktop/mobile. Saídas geradas ficam fora do lint. Pacotes sem suíte própria usam `--passWithNoTests` explicitamente, sem contabilizá-los como cobertura.

API, worker e Next são iniciados diretamente via Node pelo Playwright, com encerramento SIGTERM limitado a cinco segundos. `E2E_DATABASE_URL`, `E2E_REDIS_URL`, `E2E_API_PORT`, `E2E_WEB_PORT` e `E2E_NEXT_DIST_DIR` permitem recursos exclusivos de testes; o Redis de aplicação (`REDIS_URL`) não é herdado como destino E2E. Servidores existentes não são reutilizados nem encerrados automaticamente.

**Limite:** usar banco e Redis exclusivos para cada execução concorrente. Os providers externos permanecem simulados; a suíte não comprova comunicação real com Meta, Anthropic, Google ou S3.

As credenciais do seed E2E são fixadas nas fixtures compartilhadas com os testes, independentemente de `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` do shell. O armazenamento é forçado para `local` no seed e nos servidores E2E.

**Evolução em 2026-09-27:** todos os pacotes agora têm testes próprios e `--passWithNoTests` foi removido. O destino E2E é validado antes de conectar, e o reset sem `FORCE` ocorre no primeiro processo, antes de iniciar API/worker/painel; conexões existentes ao banco fazem o setup falhar sem serem encerradas.

## D-018 — Entrada WhatsApp transacional e recuperação de jobs pendentes

**Contexto:** uma falha entre PostgreSQL e Redis podia deixar um webhook sem job ou uma mensagem gravada sem mídia, métricas, lead ou resposta. O retorno antecipado por duplicação impedia completar o processamento.

**Decisão:** a ingestão usa transação serializável no client com escopo de empresa para contato, conversa, mensagem, mídia, métricas, lead e outbox. Conflitos concorrentes refazem a transação com limite de tentativas. Somente depois do commit os jobs são publicados. Retries consultam o estado persistido e recompõem apenas trabalho pendente, sem incrementar contadores nem reagendar entradas já tratadas.

A classificação compartilhada de conflito reconhece `P2034` e o `DriverAdapterError` de COMMIT do adapter-pg adotado (`TransactionWriteConflict`, SQLSTATE `40001`/`40P01`). Erros genéricos, conexão e outras restrições não recebem esse retry.

Reentregas de webhooks `RECEIVED`/`PROCESSING` publicam o mesmo `jobId`. `FAILED` segue a política limitada de retries do worker; um job esgotado retido pelo BullMQ requer intervenção explícita. Não há reconciliador global, replay administrativo ou garantia de envio externo exatamente uma vez. Registros parciais anteriores à correção não recebem backfill automático. A chave real de webhook é `(provider, dedupeKey)`, corrigindo a descrição simplificada de D-006.

## D-019 — Bootstrap explícito do primeiro administrador

**Contexto:** seed de produção cria apenas referências e a criação normal de administradores exige autenticação. Uma implantação vazia não possuía caminho seguro para criar o primeiro proprietário.

**Decisão:** CLI dedicada recebe banco, e-mail, nome e senha explícitos via ambiente/entrada não interativa, sem argumentos com senha, defaults demo ou inicialização de providers. Usa Argon2 existente e uma transação com advisory lock para criar exatamente um primeiro `PLATFORM_OWNER` e sua auditoria. Recusa qualquer administrador existente (inclusive inativo) e não promove/substitui usuários com e-mail já cadastrado. Não serve para recuperar acesso.

**Verificação:** testes de concorrência, rollback da auditoria, preservação de usuários, validação e CLI; o smoke de bundles também carrega esse entrypoint sem conectar ao banco.

## D-020 — Preservar aceite de envio e recuperar efeitos locais

**Contexto:** o catch de envio também capturava falhas de métricas/enqueue após o provider aceitar a mensagem e convertia seu estado em `FAILED`. Mídias já processadas podiam perder o agendamento da IA quando Redis falhava.

**Decisão:** classificar como falha de envio apenas a validação/preparação/chamada do provider. Depois do aceite, persistir ID externo e `sentAt`; retries com esse aceite registrado completam consumo/outbox de forma transacional e não chamam o provider novamente. A outbox existente identifica o efeito já registrado. Mídia finalizada apenas recupera agendamento de entrada ainda pendente.

**Limites:** não há atomicidade entre API externa e PostgreSQL, nem garantia de exactly-once externo. A recuperação depende de retry e dos registros ainda retidos; não se deve reproduzir jobs antigos depois da retenção sem reconciliação operacional.

## D-021 — Lease renovável para turnos de conversa

**Contexto:** a implementação existente adotou Redis, diferindo do advisory lock proposto em D-007. O TTL fixo de 180 segundos podia expirar durante um turno com múltiplas chamadas/tools e permitir sobreposição.

**Decisão:** preservar Redis e renovar o TTL por script Lua que verifica o token, a cada terço do prazo. Cada lease usa conexão dedicada, sem reconexão/fila offline e com comandos limitados por timeout. Prazo monotônico, falha de renovação, perda do token ou fechamento da conexão invalidam a posse permanentemente; a liberação só remove o próprio token. O runner verifica a posse antes de iniciar a IA e antes de novos efeitos de controle/publicação. Tools ainda não iniciadas retornam `lease_lost` antes de entrar no handler após perda da posse.

Não interromper o loop já iniciado permite registrar o consumo e resultado retornados pelo engine; falhas intermediárias ainda podem perder consumo parcial no fluxo existente. Perda da lease impede resposta/fallback tardios e mantém entradas pendentes para retry, sem incrementar a falha operacional da IA. Sem Redis, os testes preservam lock local ao processo.

**Limites:** não há fencing transacional com PostgreSQL nem cancelamento de requests/tools já em voo. A checagem local não consulta Redis em cada efeito; troca silenciosa de token só é detectada na renovação. O loop de IA já iniciado pode continuar chamadas até concluir/atingir o limite configurado, embora novas tools sejam bloqueadas. Não se promete exclusividade absoluta sob partições ou pausas do processo.

## D-022 — Preservar referências de arquivos quando a exclusão falha

**Contexto:** exclusões de contato/conversa/documento e retenção ignoravam falhas do storage, apagando as referências necessárias para repetir a remoção. O cascade também podia remover uma mídia recente ligada a uma mensagem antiga sem excluir seu objeto.

**Decisão:** remover os objetos conhecidos antes dos registros e propagar falhas, preservando referências para retry. Os providers adotados têm delete idempotente. A retenção inclui mídia que será removida pelo cascade da mensagem, continua as outras empresas em caso de falha isolada e termina o job com erro agregado após a limpeza técnica.

**Limites:** arquivos já removidos não são restaurados se uma etapa posterior falhar. Não há transação entre storage e banco, marca de exclusão nem bloqueio de uploads concorrentes; esses fluxos ainda precisam de reconciliação para concorrência, objetos órfãos anteriores e cópias externas. O job de retenção repete no próximo agendamento, sem novo mecanismo de retry imediato.

## D-023 — Estado da empresa no atendimento automático

**Contexto:** `SUSPENDED`/`CANCELLED` impediam o acesso normal ao painel, mas os jobs de atendimento continuavam iniciando IA e enviando mensagens. O botão de suspensão do agente altera `enabled` separadamente.

**Decisão:** verificar o estado da própria empresa antes de novos turnos automáticos, antes da primeira chamada após preparar contexto, na revalidação do resultado e antes de novos resumos/envios. Suspensão/cancelamento mantém entradas pendentes, descarta resposta/fallback tardios e marca envio pendente como `send_blocked` sem chamar o provider. Um aceite externo já persistido continua reparando consumo/outbox, sem reenviar.

Preservar `enabled`, o comportamento de `ONBOARDING` e o teste manual explícito acessado por suporte autorizado. Reativar a empresa não desfaz pausa manual, não reenfileira automaticamente entradas antigas nem reabre mensagens `FAILED`.

**Limites:** não é uma parada global de jobs. Recebimento, status de entrega, mídia/STT, calendário, conhecimento e manutenção continuam seus fluxos existentes. Engine, tools e requests já iniciados podem concluir; resumo já em voo pode concluir pelo fluxo existente, sem cancelamento pela suspensão. Há janela entre checagem e efeito, sem cancelamento externo ou fencing transacional.

## D-024 — Registrar consumo do resumo antes do resultado de domínio

**Contexto:** resposta vazia retornava antes de registrar uso, e falha na gravação do resumo também perdia as métricas já recebidas do provider.

**Decisão:** persistir `UsageRecord` imediatamente após a resposta, antes de verificar texto vazio e antes do upsert do resumo. Falha do provider sem métricas não recebe uso inventado; preços, schema e contagem permanecem existentes. Cada nova tentativa que chama o provider representa uma nova operação de consumo.

**Limites:** não há transação entre provider e banco. Queda/falha de persistência após consumo externo ainda pode impedir registro. Custo desconhecido, uso por modelo e consumo parcial do loop principal continuam pendentes no plano próprio.

## D-025 — Tentativas e recusas do provider de IA explícitas; composição sem degradação silenciosa

**Contexto:** a [documentação oficial de refusals e fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback) (conferida em 2026-09-27) define que, com `fallbacks`, o `usage` de topo cobre apenas a tentativa que produziu a resposta. Cada tentativa, inclusive as recusadas e cobráveis, aparece em `usage.iterations`. O adapter descartava `iterations` e `stop_details`, e não havia testes do provider real. Além disso, `createProviders` trocava silenciosamente um provider real incompleto por mock/local. Isso só era impedido porque todos os chamadores usavam o env validado.

**Decisão:**

- `AIResponse` mantém `usage` com a semântica da API e ganha `attempts` (modelo, `served`, `fallback`, tokens), além de `refusal` (`category`, `explanation`, `recommendedModel`). O engine acumula `attempts` do turno e expõe `refusal`. O runner grava a categoria em `AgentRun.errorMessage` (sem migração) e registra fallback/recusa em log, porque ambos chegam como HTTP 200.
- O conteúdo do assistente continua sendo devolvido intacto no loop de tools, o que preserva a posição do bloco `fallback` exigida pela API. O caminho beta usa os tipos do SDK 0.128, sem conversões forçadas.
- `createProviders` falha quando um provider real configurado está incompleto e recusa `mock`/`local` com `NODE_ENV=production`, como segunda barreira além de `validateEnvRules`.
- A homologação real tem uma etapa automatizada (`pnpm homolog:anthropic [--cache]`) sobre o mesmo provider/engine do atendimento, com relatório sem segredos. Os testes de contrato usam o SDK real contra servidor HTTP local.

**Limites:** tentativas recusadas antes de um fallback ainda não entram no custo estimado. O custo delas depende de categorias não expostas por tentativa e segue o [plano de custos](docs/COST_ACCOUNTING_PLAN.md). Testes de contrato comprovam o formato documentado, não a aceitação pela conta real; a homologação continua pendente de credencial.

## D-026 — WhatsApp: BSUID sem perda silenciosa, erros oficiais e versão Graph

**Contexto:** conferência de 2026-09-27 com a documentação oficial da Meta:

- Desde abril de 2026, os webhooks trazem BSUID (`user_id`, `from_user_id`, `recipient_user_id`) e `username`. O telefone (`from`/`wa_id`) é omitido para usuários com nome de usuário sem interação com o número nos últimos 30 dias. O parser exigia `from`/`wa_id` e descartava essas mensagens, ou todas as mensagens da alteração quando um contato vinha sem `wa_id`. Nenhum registro ficava para diagnóstico.
- A tabela oficial de erros marca `131057` e `133004` como "tentar depois".
- A Graph API atual é `v26.0` (2026-07-29). D-011 descrevia `v25.0` como atual.
- A partir de 2026-10-01, mensagens de serviço (texto livre na janela) são cobradas por mensagem, ao preço de utility.

**Decisão:**

- O parser preserva BSUID/username e aceita contato sem `wa_id`. Mensagem sem telefone vira evento `message_without_phone`, gravado como `WebhookEvent` `IGNORED` com empresa e payload completo, sem job, com `ErrorLog` (sem o texto) e log `warn`. Assim, fica retida para reprocessamento em vez de desaparecer ou ser marcada `PROCESSED` sem efeito.
- A identificação por telefone (`Contact.phone`) permanece. Contato/envio por BSUID exige migração e decisão de produto: telefone opcional, vínculo e mescla quando o telefone surgir, `recipient` no envio e troca de número. Esse trabalho foi registrado como próxima etapa, não implementado agora.
- Retries incluem `131057`/`133004`. Códigos que exigem ação humana ganham orientação em português, e `131049` não é repetido pelos retries curtos.
- O padrão continua `v25.0` (suportada até 2028-07-29) enquanto não houver homologação. O roteiro manda homologar em `v26.0` e então trocar o padrão.
- A homologação real ganha uma etapa automatizada, somente leitura por padrão: `pnpm homolog:whatsapp`. Ela confere URL/segredos do webhook, token/número, inscrição do app na WABA e templates, e envia um template só com `--send-to`.

**Limites:** mensagens retidas não recebem resposta automática nem são reprocessadas sozinhas. O custo da Meta continua fora dos relatórios; os campos `pricing` dos status são lidos, mas não persistidos.

## D-027 — Google Agenda recusa de forma visível; S3 compatível sem checksums obrigatórios

**Contexto:** revisão de 2026-09-27 dos providers de agenda e storage:

- Um refresh token revogado ou expirado (`invalid_grant`, inclusive o prazo de 7 dias do app OAuth em "Testing") gerava erro genérico a cada consulta. A integração continuava `CONNECTED` e ninguém era avisado.
- Uma integração conectada sem `GOOGLE_*`/`ENCRYPTION_KEY` na instalação era ignorada em silêncio: a disponibilidade usava só a agenda interna, com risco de marcar sobre compromissos do Google.
- O SDK S3 (≥ 3.729) envia checksums CRC por padrão, recusados por R2 e MinIO/Ceph antigos ([anúncio da AWS](https://github.com/aws/aws-sdk-js-v3/issues/6810)).

**Decisão:**

- `GoogleReauthorizationRequiredError` (não repetível) para `invalid_grant` na renovação ou ausência de refresh token. O hook `onReauthorizationRequired` muda a integração de `CONNECTED` para `ERROR` e notifica uma única vez (`INTEGRATION_DISCONNECTED`, crítica). Falhas 5xx do endpoint de token continuam repetíveis.
- Integração em `ERROR`, ou conectada mas não montável, **recusa** a consulta com mensagem acionável. Isso preserva o comportamento existente de falhar fechado (já não havia agendamento com a autorização inválida) e o torna visível. Desconexão pelo usuário (`DISCONNECTED`) continua usando só a agenda interna.
- `S3_ENDPOINT` definido implica `requestChecksumCalculation`/`responseChecksumValidation` = `WHEN_REQUIRED`; AWS S3 mantém as proteções padrão.

**Limites:** a reconexão continua manual pelo painel. O job de espelhamento falha enquanto a integração estiver em `ERROR` e não reexecuta sozinho após reconectar. A homologação real de Google e S3 continua pendente de credenciais.

## D-028 — Meta Model API (Muse Spark) como provider próprio sobre o formato Messages

**Contexto:** em 2026-09-29 o responsável não conseguiu adicionar créditos na Anthropic (a verificação de identidade falhou) e optou pela IA oficial da Meta. A antiga Llama API foi desativada em julho/2026; a oferta atual é a [Meta Model API](https://dev.meta.ai/docs/overview), com modelos Muse Spark e endpoints compatíveis com os SDKs da OpenAI e da Anthropic. Sondagens na API real com `muse-spark-1.3` confirmaram: Messages API em `https://api.meta.ai` com texto, imagens, tools (inclusive paralelas) e `tool_result` com `is_error`; autenticação Bearer (`x-api-key` é recusado em `/v1/models`); raciocínio obrigatório (`thinking: disabled` → 400) contado em `max_tokens`/`output_tokens`; `output_config.effort` `low`/`medium`/`high`; `tool_choice` só `auto`; `max_tokens` ≥ 16; blocos `redacted_thinking`; cache automático.

**Decisão:**

- `AI_PROVIDER=meta` cria `MetaModelProvider` (`packages/ai/src/provider/meta.ts`). Ele reaproveita do adapter Anthropic a tradução de mensagens, respostas e erros (`toAnthropicMessages`, `toAIResponse`, `mapProviderError` com o nome do fornecedor), mas é um provider separado que não envia `fallbacks`/beta nem `cache_control`. O comportamento do `AnthropicProvider` não muda.
- O cliente do SDK usa `apiKey: null` + `authToken`, para nunca ler nem enviar `ANTHROPIC_API_KEY` do ambiente à Meta (coberto por teste).
- Sempre envia `effort` (padrão `medium`) e soma uma folga de raciocínio a `maxOutputTokens` (2.048/4.096/8.192 por nível). Sem isso, o padrão de 1.024 tokens por empresa cortaria respostas, porque o raciocínio (300–700 tokens medidos) não pode ser desligado.
- O catálogo e o modelo efetivo passam a respeitar o provedor ativo: prefixo `claude-` → anthropic, `muse-` → meta (`aiProviderForModel` em `@botsaas/config`). O env recusa `AI_DEFAULT_MODEL`/`AI_SUMMARY_MODEL` de outro provedor. Modelo de empresa incompatível cai no padrão sem apagar a escolha salva.
- Preço inicial `muse-spark-1.3`: US$ 1,25/M entrada, 0,15/M cache lido, 4,25/M saída (raciocínio incluso). Escrita de cache usa o preço de entrada, pois a Meta não a cobra à parte.
- `pnpm homolog:meta` repete as sondagens (e avisa quando a Meta passar a aceitar algo hoje recusado); testes de contrato cobrem 400/401/403/404/429/5xx e conexão.

**Limites:** o prompt foi escrito para Claude; qualidade de atendimento do Muse Spark depende dos cenários da Etapa 2 em `docs/AI_AGENT.md`. Latência observada de 15–18 s por turno com ferramentas (raciocínio `medium`); `low` reduz latência e custo. A folga amplia o teto de saída por chamada: `maxOutputTokens` deixa de ser um limite estrito do texto visível com esse provider. O streaming funciona no SDK, mas não é usado pelo atendimento. Não houve homologação com WhatsApp Cloud real (sem número conectado); o fluxo foi validado pelo simulador, que usa a mesma ingestão do webhook.

## D-029 — Agenda: "verificar e gravar" serializado por empresa com advisory lock

**Contexto:** em 2026-09-29, ao avaliar um pedido de evolução da plataforma, apareceu uma corrida na agenda. `createAppointment`, `rescheduleAppointment` e a reativação em `updateAppointmentStatus` liam os horários ocupados e só depois gravavam, sem transação nem trava. Um teste com 5 pedidos simultâneos para o mesmo horário reservou 4. Duas remarcações simultâneas para o mesmo horário passaram. Reativar um cancelado (→ `CONFIRMED`) não checava se o horário já tinha sido tomado.

**Decisão:**

- A checagem de agendamentos e a gravação rodam numa transação que começa com `pg_advisory_xact_lock(20260929, hashtext(companyId))`, no mesmo padrão do bootstrap do owner (D-019). O lock é por empresa, então uma empresa não bloqueia outra, e é liberado no commit/rollback.
- A consulta ao calendário externo (Google, rede) acontece **antes** da transação. Assim ela não segura o lock nem estoura o timeout da transação interativa. A corrida que o lock resolve é entre gravações no nosso banco.
- Não foi usada uma exclusion constraint (`btree_gist`) porque o painel permite **encaixe manual** (`enforceAvailability: false`), que é uma sobreposição intencional. Uma constraint impediria esse encaixe. O encaixe continua fora da checagem e é coberto por teste.
- A reativação (encerrado → ativo) passa pela mesma checagem. Mudanças entre estados ativos, ou para estados encerrados, não passam.

**Limites:** gravações que não passam por essas três funções não pegam o lock (hoje não há outras). O lock serializa as reservas por empresa, o que só pesa com volume muito alto de reservas simultâneas da mesma empresa. Remarcar um horário para perto do original ainda pode esbarrar no evento espelhado do próprio agendamento no Google, comportamento anterior a esta mudança.

## D-030 — Sessão do Postgres sempre em UTC

**Contexto:** em 2026-09-29, um teste do relatório de consumo por dia falhou: um registro das 23:30 de São Paulo caía no dia seguinte. A causa: o `@prisma/adapter-pg` envia `Date` **sem fuso**, e o Postgres local (embedded) herda o fuso da máquina (`America/Santiago`). Um `2026-09-10T02:30Z` gravado pelo app era guardado como `05:30Z`. O Prisma desfazia o deslocamento na leitura, então o app parecia correto. Mas valores gerados pelo banco (`now()`, `@default(now())`) ficavam certos e os gravados pelo app ficavam deslocados, e todo SQL com datas (agrupar por dia, `AT TIME ZONE`) errava. Servidores em UTC, o padrão dos Postgres gerenciados, não manifestam o problema.

**Decisão:** `createPrismaClient` abre toda sessão com `options: '-c TimeZone=UTC'`. O teste `apps/api/test/db-timezone.test.ts` configura o banco de teste fora de UTC (`ALTER DATABASE … SET timezone`) para reproduzir o problema em qualquer ambiente, inclusive no CI.

**Limites:** dados já gravados por esta aplicação num Postgres local fora de UTC continuam deslocados (horários do app aparecem adiantados pelo offset do servidor). É só dado de desenvolvimento: reseede ou recrie o banco local. Produção em UTC não é afetada. Conexões `pg` diretas (hoje só o setup E2E, sem datas) não passam por esse ajuste.

## D-031 — Relatório de consumo da IA por dia, cliente e modelo

**Contexto:** o custo por chamada já era registrado (`UsageRecord`), mas só havia totais por período e o custo total por empresa. Para a WebZen cobrar e acompanhar cada cliente faltavam o recorte por dia, modelo e provedor, um intervalo livre e a qualidade (erros e latência).

**Decisão:** `GET /api/platform/usage/breakdown` (`platform:usage:read`, fuso de São Paulo, filtro opcional `companyId`) e `GET /api/app/metrics/usage/breakdown` (`usage:read`, fuso da empresa, só a própria empresa). Os dois recebem `from`/`to` (AAAA-MM-DD, inclusivos, padrão = mês corrente, máximo 366 dias) e devolvem `totals`, `byDay`, `byModel` (com provedor) e, na plataforma, `byCompany`. Custo e tokens vêm de `UsageRecord` (`AI_CALL`, sem testes). Execuções, falhas e latência média vêm de `AgentRun` (`SUCCEEDED`/`FAILED`, sem `TEST_CHAT`). Não houve migração nem tabela de agregados: a agregação é feita em SQL com `AT TIME ZONE`, e o filtro de empresa é explícito porque o SQL cru não passa pela extensão de tenant.

**Limites:** o recorte por dia usa o instante de início da execução. Custos desconhecidos seguem o [plano de custos](docs/COST_ACCOUNTING_PLAN.md). Ainda não há exportação CSV nem tela no painel (os endpoints estão prontos). Tabela de agregados só se o volume exigir.

## D-032 — Recuperação automática de respostas travadas

**Contexto:** D-018 registrava que um `agent.reply` perdido ou esgotado deixava a mensagem do cliente sem resposta até alguém intervir, porque não havia reconciliador. As falhas da IA em si já estavam cobertas: na última tentativa, o runner aplica o fallback, notifica e marca as entradas. O que ficava sem resposta era o **trabalho perdido**: worker que caiu, Redis fora no enqueue, webhook que esgotou tentativas.

**Decisão:** job periódico `agent.recover-stalled` (a cada 5 min, via `upsertJobScheduler`, sem duplicar entre réplicas). Ele procura conversas `WHATSAPP` em modo `AI`, não fechadas, de empresas não suspensas/canceladas e com IA ativa, que tenham mensagem do cliente sem `agentHandledAt` há mais de 10 min e menos de 6 h. Para essas, reagenda `agent.reply` (deduplicação por conversa; o runner relê o banco, então repetir é idempotente). Se houver execução `RUNNING` com menos de 5 min, espera. Se já houve **3 execuções concluídas** desde a mensagem pendente mais antiga e ela segue sem tratamento, a falha é persistente e pode estar cobrando IA a cada ciclo. Nesse caso a conversa vai para humano via `requestHandoff`, com nota, notificação e evento, e sai dos próximos ciclos.

**Limites:** mensagens de **saída** com falha não são reenviadas automaticamente, porque a Meta pode tê-las aceitado (D-020); isso segue manual (INCIDENTS). Entradas com mais de 6 h ficam para intervenção humana. O lote é de 500 mensagens por ciclo (com log de aviso ao atingir). Registros parciais anteriores a D-018 continuam sem backfill.

## D-033 — Custo do WhatsApp gravado por mensagem e somado ao relatório

**Contexto:** a partir de 2026-10-01 a Meta cobra cada mensagem de serviço (inclusive as respostas da IA) ao preço de utility/authentication do mercado. O parser já lia `pricing` dos status, mas o dado era descartado, e os relatórios só contavam a IA. A página oficial não traz a tabela que vale em 2026-10-01, que é publicada à parte. O único valor oficial disponível é o exemplo para o Brasil: 0,68 ¢ (tabela de 2026-07-01).

**Decisão:**

- `Message` ganha `billable`, `pricingCategory` e `pricingModel` (colunas opcionais, migração só de adição) e o índice `(billable, createdAt)` para a visão da plataforma. `applyStatusUpdate` grava a cobrança no **primeiro** status que a traz, inclusive quando o status é ignorado por chegar fora de ordem, e não a sobrescreve depois.
- Preço: referência em `packages/whatsapp/src/pricing.ts` (service/utility/authentication = US$ 0,0068) mais `WHATSAPP_PRICE_USD` (JSON por categoria, validado no env), que prevalece. **Categoria sem preço não recebe valor inventado**: é contada como `whatsappUnpricedMessages` e sai com `costUsd: null` em `whatsappByCategory`.
- O relatório de consumo (D-031) inclui `whatsappMessages`, `whatsappCostUsd` e `whatsappUnpricedMessages` nos totais, por dia e por cliente, além de `whatsappByCategory`. O WhatsApp não entra em `byModel`, porque não é modelo de IA.

**Limites:** um único mercado (Brasil). Destinatários de outros países são valorados pela mesma tabela. Mensagens enviadas antes desta mudança não têm cobrança gravada. O dia de referência é o de criação da mensagem. O custo é estimativa: reconcilie com a fatura do WhatsApp Manager.
