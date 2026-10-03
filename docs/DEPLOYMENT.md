# Operação e deploy

Este guia descreve os processos existentes. O repositório ainda não inclui imagens de produção, manifests de infraestrutura ou deploy automatizado. O `docker-compose.yml` atual é de desenvolvimento, com credenciais e portas locais.

## Componentes

| Processo | Comando a partir da raiz                  | Dependências                                           |
| -------- | ----------------------------------------- | ------------------------------------------------------ |
| API HTTP | `pnpm --filter @botsaas/api start`        | PostgreSQL, Redis, configuração validada               |
| Worker   | `pnpm --filter @botsaas/api start:worker` | Mesmo PostgreSQL, Redis e chave de criptografia da API |
| Painel   | `pnpm --filter @botsaas/web start`        | API acessível pelo destino de rewrite                  |

API e worker compartilham o bundle e os módulos; são processos separados. Configure supervisão e reinício no ambiente de hospedagem. API escuta `API_HOST`/`API_PORT` (padrões `0.0.0.0:4000`); o script de painel usa porta 3000. Não exponha PostgreSQL ou Redis à internet.

Use uma instalação completa do workspace, preservando `node_modules`/links do pnpm: o esbuild incorpora o código dos pacotes internos, mas mantém dependências npm externas. Copiar somente `apps/api/dist` para outro host não produz um deploy autossuficiente. Prisma Client é gerado no `postinstall` de `packages/database`.

## Preparar uma release

Requisitos: Node ≥ 22.12, pnpm conforme `packageManager`, PostgreSQL 16+ e Redis 7+. Instale/build no mesmo tipo de plataforma do runtime para preservar binários nativos.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
API_INTERNAL_URL=http://127.0.0.1:4000 pnpm build
pnpm test:build
```

`pnpm test` usa um banco de testes separado; veja [VALIDATION.md](VALIDATION.md). `API_INTERNAL_URL` precisa apontar para o endereço interno que o painel alcançará em produção **durante o build**: o Next grava os rewrites no artefato. Em containers, `127.0.0.1` só funciona se API e painel estiverem na mesma rede/processo de host; use o DNS interno correto do serviço.

O smoke `test:build` verifica resolução de imports e rejeição de mocks em produção; não consulta serviços externos. Homologue o runtime e os providers antes de expor atendimento real.

## Configuração de produção

API e worker recebem variáveis pelo gerenciador de processos/segredos do host. Os comandos `start` executam Node e **não carregam `.env` automaticamente**. Nunca use variáveis `NEXT_PUBLIC_*` para segredos. Valores e regras exatas estão em [env.ts](../packages/config/src/env.ts) e [.env.example](../.env.example).

| Grupo           | Configuração                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ambiente        | `NODE_ENV=production`, `LOG_LEVEL=info`, `APP_URL` e `API_PUBLIC_URL` HTTPS                                                                                                               |
| Banco/fila      | `DATABASE_URL` e `REDIS_URL` exclusivos da implantação                                                                                                                                    |
| Criptografia    | `ENCRYPTION_KEY` de 32 bytes em base64, igual na API e no worker                                                                                                                          |
| IA              | `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` ou `AI_PROVIDER=meta` + `META_MODEL_API_KEY`; modelo homologado em `AI_DEFAULT_MODEL`                                                       |
| Rede/abuso      | `TRUST_PROXY` = saltos do balanceador (ex.: `1`) ou IPs/CIDRs dele; `RATE_LIMIT_PER_MINUTE`, `LOGIN_RATE_LIMIT_PER_MINUTE`, `LOGIN_ACCOUNT_MAX_ATTEMPTS`, `AI_TEST_RATE_LIMIT_PER_MINUTE` |
| WhatsApp        | `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, versão Graph homologada                                                                                |
| Objetos         | `STORAGE_PROVIDER=s3`, `S3_BUCKET`, região/endpoint e credenciais ou identidade do host                                                                                                   |
| Áudio           | `STT_PROVIDER=none` ou `openai-compatible` com URL/chave/modelo necessários                                                                                                               |
| Google opcional | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`                                                                                                                         |

`parseEnv` recusa IA/WhatsApp/STT mock e armazenamento local em produção. Não há flag que libere mocks nesse ambiente. A composição dos providers repete essa recusa e falha quando um provider real configurado está incompleto, em vez de trocá-lo por simulação (D-025). Mantenha a chave de criptografia persistente e protegida: trocá-la sem recriptografar os registros torna os tokens existentes ilegíveis; rotação automatizada ainda não existe.

A configuração de token WhatsApp é por número/empresa e acontece no painel; App Secret e Verify Token são da plataforma. A validação de env não comprova validade de credenciais nem acesso a um modelo ou bucket.

### Checklist de segurança antes de abrir para clientes

- [ ] `NODE_ENV=production`, `LOG_LEVEL=info` (sem `debug`/`trace`), `COOKIE_SECURE` não desligado.
- [ ] `APP_URL` e `API_PUBLIC_URL` em **HTTPS**; o painel envia HSTS e CSP em produção.
- [ ] Segredos só no gerenciador do host (nunca em arquivo versionado); `pnpm check:secrets` limpo.
- [ ] `ENCRYPTION_KEY` própria, com cópia recuperável fora do backup do banco.
- [ ] `TRUST_PROXY` com os saltos/IPs do balanceador; API sem acesso direto que contorne o proxy.
- [ ] Limites de requisição revisados para o volume esperado (login por IP e por conta, teste da IA).
- [ ] Usuário do banco da aplicação sem privilégio de superusuário; backups cifrados e com acesso restrito.
- [ ] Webhook da Meta com `WHATSAPP_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN` fortes.
- [ ] Bucket de arquivos privado; chave do storage restrita a esse bucket.
- [ ] Primeiro administrador criado com `start:bootstrap-owner` (sem credencial padrão) e senha forte.
- [ ] Logs e alertas acompanhados: falhas de login, `login_account_limited`, assinatura de webhook inválida e erros 5xx.

## Rede, cookies e callbacks

O navegador acessa `/api/*` no mesmo domínio do painel; o Next encaminha à API. O cookie `sid` é host-only, httpOnly e SameSite=Lax; Secure por padrão em produção. Termine TLS em um proxy confiável e mantenha a API protegida contra acesso que contorne esse proxy. O IP do cliente só vem de `X-Forwarded-For` quando a conexão chega de um proxy listado em `TRUST_PROXY`; sem essa variável o IP usado nos limites é o da conexão (o do próprio balanceador, que então concentraria todo o tráfego num único limite). `TRUST_PROXY=true` é recusado (D-034).

- Webhook Meta: publique `API_PUBLIC_URL/webhooks/whatsapp` com o corpo bruto intacto. Veja [WHATSAPP.md](WHATSAPP.md).
- Google: cadastre `APP_URL/api/integrations/google/callback` como redirect URI, usando o rewrite. O callback exige a sessão do usuário que iniciou a conexão; um callback em outro subdomínio não recebe automaticamente o cookie do painel.
- Google OAuth em produção: `calendar.events` é um escopo **sensível**, portanto o app OAuth precisa ser publicado ("In production") e passar pela verificação do Google. Com o app em "Testing", só usuários de teste conectam e os refresh tokens **expiram em 7 dias**. Quando o Google recusa a renovação (`invalid_grant`), a integração vai para `ERROR` e a equipe recebe uma notificação crítica. A agenda passa a recusar consultas de horário até a reconexão, em vez de ignorar o Google e arriscar marcação sobreposta. Integração conectada sem `GOOGLE_*` ou sem `ENCRYPTION_KEY` na instalação também recusa (D-027).
- S3 compatível (R2, MinIO, Ceph): com `S3_ENDPOINT` definido, o cliente só envia checksums quando a operação exige (`WHEN_REQUIRED`). Os checksums CRC padrão do SDK desde a versão 3.729 são recusados por R2 e por versões antigas de MinIO/Ceph. No AWS S3 (sem endpoint), as proteções padrão continuam ativas.
- `APP_URL` deve corresponder à origem real usada pelo navegador, pois o CSRF verifica Origin nas mutações.

## Migrações e dados iniciais

Com `DATABASE_URL` do destino injetada, aplique migrações antes de iniciar os novos processos:

```bash
pnpm db:migrate:deploy
pnpm db:seed -- --reference
```

O seed de referência cria planos/preços ausentes e não sobrescreve registros existentes. Confira os preços e planos no painel antes de usá-los comercialmente. O seed completo cria dados e usuários de demonstração e é bloqueado em produção; não reduza `NODE_ENV` para contornar essa proteção.

Antes de expor uma implantação nova, provisione o primeiro `PLATFORM_OWNER` com `pnpm --filter @botsaas/api start:bootstrap-owner` após o build. Injete `DATABASE_URL`, `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME` e `BOOTSTRAP_OWNER_PASSWORD` pelo gerenciador de segredos; a senha também pode vir de stdin não interativo. Não passe a senha como argumento nem a grave no histórico do shell. O comando não carrega `.env` nem inicializa providers. Para desenvolvimento existe `pnpm --filter @botsaas/api bootstrap:owner`.

O bootstrap recusa qualquer administrador de plataforma existente, inclusive inativo, e recusa e-mail que já pertença a um usuário. Não promove nem substitui contas; não é um mecanismo de recuperação. Um lock transacional serializa execuções concorrentes e a criação do proprietário e da auditoria `platform.owner_bootstrapped` ocorre atomicamente. A gestão dos administradores seguintes existe em `/platform/admin`.

Migrações não têm rollback automático. Faça backup e teste restauração num ambiente separado antes de uma mudança de schema; prefira alterações compatíveis com as versões antiga e nova durante a troca de processos. Não use `migrate reset`, `db push --force-reset` nem seeds demo no destino de produção.

## Verificar operação

1. `GET /health`: processo HTTP responde (não confirma banco/fila).
2. `GET /health/ready`: retorna 200 apenas com consulta ao PostgreSQL e ping Redis; falhas retornam 503.
3. No painel `/platform/admin`, confira banco, Redis, heartbeat do worker, storage e indicadores dos providers. O heartbeat expira e a saúde considera um sinal com menos de 60 segundos.
4. Faça login, troque empresa e confira que dados de outra empresa não aparecem.
5. Execute um teste de agente e depois uma mensagem controlada real somente na empresa/número de homologação.

A saúde de IA e WhatsApp usa histórico local, não uma chamada externa de validação. Google configurado não prova que o OAuth da empresa continua válido. Estado `ok` nessas linhas não substitui homologação.

Logs são estruturados com request/job/company IDs e redaction dos campos conhecidos. Colete logs dos três processos, retenha erros e configure alertas para readiness indisponível, heartbeat ausente, aumento de `ErrorLog`, jobs falhos e limites/custos. Não inclua tokens ou payloads de clientes em relatórios públicos.

## Recuperação e limites atuais

Use [INCIDENTS.md](INCIDENTS.md) para investigar entrada sem resposta, envio incerto, perda de lease e falhas de exclusão com os controles existentes.

- API e worker respondem a SIGTERM; o worker aguarda jobs ativos. Dê ao supervisor tempo compatível com chamadas de IA e retries antes de forçar encerramento.
- Redis precisa persistir filas e usar política `noeviction`. Banco, Redis e storage precisam de backup/recuperação próprios; restaurar só PostgreSQL não recupera arquivos ou jobs.
- A fila usa retries/backoff; não reenvie manualmente mensagens sem verificar `Message.externalId`, estado da mensagem e evento original. Um timeout externo pode deixar resultado incerto.
- A lease de conversa usa Redis com TTL de 180 s renovado a cada 60 s, por conexão dedicada e comandos limitados a 2 s. Perda da posse impede efeitos tardios do runner; não há fencing com PostgreSQL nem cancelamento de requests/tools em andamento. Dimensione conexões Redis para os turnos ativos e monitore falhas de lease (D-021).
- Homologação real de Meta, Anthropic, Google, storage e STT ainda depende de credenciais e ambiente controlado. Veja [VALIDATION.md](VALIDATION.md) para o que já é comprovado sem elas.
