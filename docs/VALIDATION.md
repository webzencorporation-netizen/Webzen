# Validação local

Execute os comandos na raiz do monorepo com Node ≥ 22.12 e a versão de pnpm declarada em `package.json`. A retomada usa o código e as dependências já existentes; não requer credenciais reais de IA ou WhatsApp.

## Preparação

```bash
pnpm install --frozen-lockfile
docker compose up -d
# Alternativa ao Docker, em outro terminal:
# pnpm services:local
```

Os testes da API precisam de PostgreSQL e aplicam as migrações antes da suíte. `TEST_DATABASE_URL` pode ser definido no ambiente ou em `.env`; o padrão é `postgresql://botsaas:botsaas@localhost:5432/botsaas_test`. O nome precisa conter `test`. As tabelas desse banco são truncadas entre cenários; nunca aponte para dados que queira preservar. A infraestrutura ainda não é iniciada automaticamente pelos testes.

## Qualidade, integração e build

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:build
```

`pnpm test` executa suítes de configuração, regras compartilhadas, banco, IA, WhatsApp, integrações, preparação E2E e API. Todos os pacotes com script de teste têm suíte própria, sem `--passWithNoTests`. A API usa PostgreSQL real e filas/providers em memória; a lease também é testada com relógio simulado e ioredis real contra socket TCP local silencioso. Integrações usam storage temporário e respostas HTTP/SDK simuladas, sem acesso real a Google/STT/S3; o web separa Vitest de Playwright.

`pnpm test:build` importa `dist/main.js` e `dist/worker.js` com configuração intencionalmente inválida para produção. Ambos devem alcançar a validação e recusar mocks. Também carrega `dist/bootstrap-owner.js` e exige recusa de `DATABASE_URL` ausente. Nenhuma conexão externa é feita; isso detecta dependências faltantes no bundle, que um build bem-sucedido sozinho não revela.

O workflow [CI](../.github/workflows/ci.yml) executa checks, build, smoke e Playwright em PostgreSQL/Redis descartáveis do job, com bancos separados para integração e E2E. Foi validado localmente; sua primeira execução no GitHub ainda precisa ser confirmada. Não utiliza credenciais reais nem faz deploy.

## Fluxos de navegador

```bash
pnpm --filter @botsaas/web exec playwright install chromium
pnpm test:e2e
```

O Playwright sobe API, worker BullMQ e painel Next, usando PostgreSQL e Redis reais e providers externos simulados. O primeiro processo prepara o banco e o seed Clínica Demo antes de iniciar a API; sua disponibilidade libera worker e painel. O hook `globalSetup` não é usado porque executaria após os servidores na versão adotada. Use somente recursos dedicados a testes.

O destino é validado antes de conectar: protocolos PostgreSQL, sem query/fragmento e nome ASCII `botsaas_(segmentos_)e2e(_segmentos)` de até 63 caracteres. Os exemplos abaixo e `botsaas_ci_e2e` são aceitos. O reset não usa `FORCE`: banco em uso faz o setup falhar, sem encerrar conexões existentes. Configurações SSL via query não são aceitas por esse runner.

As credenciais usadas no seed vêm de `apps/web/e2e/fixtures.ts`, compartilhado com os testes. `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` do shell não alteram esse seed; o armazenamento é forçado para `local`.

| Variável            | Padrão                                                    | Uso                                                        |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `E2E_DATABASE_URL`  | `postgresql://botsaas:botsaas@localhost:5432/botsaas_e2e` | Banco descartável, família `botsaas_*e2e*` validada        |
| `E2E_REDIS_URL`     | `redis://localhost:6379/5`                                | Redis exclusivo dos jobs de teste; separado de `REDIS_URL` |
| `E2E_API_PORT`      | `4100`                                                    | API de testes                                              |
| `E2E_WEB_PORT`      | `3100`                                                    | Painel de testes                                           |
| `E2E_NEXT_DIST_DIR` | `.next-e2e`                                               | Build temporário dentro de `apps/web`                      |

Se já houver servidores nas portas padrão, escolha outro conjunto sem encerrar processos de desenvolvimento:

```bash
E2E_API_PORT=4200 \
E2E_WEB_PORT=3200 \
E2E_DATABASE_URL=postgresql://botsaas:botsaas@localhost:5432/botsaas_e2e_resume \
E2E_REDIS_URL=redis://localhost:6379/6 \
E2E_NEXT_DIST_DIR=.next-e2e/resume \
pnpm test:e2e
```

Use também outro banco e Redis em execuções concorrentes. O runner recusa reutilizar servidores em execução e encerra os que ele próprio iniciou. Não use `pnpm exec` nos comandos `webServer`: no pnpm 12 isso pode separar os grupos de processos e deixar servidores órfãos; os comandos Node diretos preservam o teardown do Playwright.

São seis fluxos desktop completos (login, proteção de rotas, mensagem/IA/handoff, teste do agente, criação de empresa e bloqueio da plataforma para usuário de empresa), dois cenários desktop de troca de senha com API simulada e um mobile (inbox e retorno à lista). O enforcement real de senha é coberto pela suíte API; os cenários simulados verificam modal e recuperação do cache. Traces de falha ficam em `apps/web/test-results`.

## Limites da validação

- Os testes não enviam mensagens à Meta nem fazem chamadas pagas à Anthropic.
- Build e mocks aprovados não comprovam OAuth Google, S3, transcrição externa, credenciais Meta ou disponibilidade/preço do modelo Claude configurado.
- Há avisos de depreciação de Fastify e pg nas dependências atuais; são registrados em `PROGRESS.md` para acompanhamento.
- Num clone novo, confirme que os quatro fontes de `packages/integrations/src/storage` estão versionados. Somente os diretórios de uploads na raiz e em `apps/api/storage` devem ser ignorados.

## Homologação com credenciais reais

Os testes de contrato exercitam os SDKs/clientes reais contra servidores e respostas locais: Anthropic em `packages/ai/test/anthropic-provider.test.ts`, Cloud API em `packages/whatsapp/test/cloud-api.test.ts`. A primeira etapa da homologação real é automatizada e não usa banco nem Redis:

| Comando                                     | Requer                                                         | Custo/efeito                                                      |
| ------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm homolog:anthropic [--cache]`          | `ANTHROPIC_API_KEY`, `AI_DEFAULT_MODEL` (e `AI_SUMMARY_MODEL`) | Poucas chamadas pequenas e pagas; `--cache` soma ~12 mil tokens   |
| `pnpm homolog:whatsapp [--send-to=<teste>]` | `HOMOLOG_WA_ACCESS_TOKEN`, `HOMOLOG_WA_PHONE_NUMBER_ID`, WABA  | Somente leitura; `--send-to` envia um template ao número de teste |

Cada comando imprime um relatório sem segredos e sai com código 1 se alguma verificação falhar. As etapas seguintes (cenários de negócio) estão em [AI_AGENT.md](AI_AGENT.md) e [WHATSAPP.md](WHATSAPP.md).

Consulte `PROGRESS.md` para a execução mais recente e as pendências de homologação.
