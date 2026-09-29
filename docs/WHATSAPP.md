# WhatsApp: configuração e operação

Este guia descreve o código existente, com providers `cloud` (Meta Cloud API oficial) e `mock`. A validação local registrada em [PROGRESS](../PROGRESS.md) usa serviços externos simulados; nenhuma homologação real da Meta é afirmada aqui. Não há integração por WhatsApp Web ou QR code.

## Configuração da plataforma e da empresa

As regras estão em [env.ts](../packages/config/src/env.ts) e a implementação HTTP em [cloud-api.ts](../packages/whatsapp/src/cloud-api.ts).

| Configuração                                    | Uso no código                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_PROVIDER=mock`                        | Padrão de desenvolvimento; não envia à Meta. É recusado em `NODE_ENV=production`.                                         |
| `WHATSAPP_PROVIDER=cloud`                       | Ativa chamadas reais; exige `WHATSAPP_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.                                      |
| `WHATSAPP_GRAPH_API_VERSION`                    | Padrão do repositório: `v25.0` (suportada até 2028-07-29). A atual é `v26.0` (2026-07-29): homologue nela e então troque. |
| `WHATSAPP_GRAPH_API_BASE_URL`                   | Padrão `https://graph.facebook.com`; só altere conscientemente em ambiente de testes.                                     |
| `API_PUBLIC_URL`                                | Origem pública usada para exibir a URL `${API_PUBLIC_URL}/webhooks/whatsapp`.                                             |
| `ENCRYPTION_KEY`                                | Chave de 32 bytes em base64 para criptografar tokens; API e worker devem usar a mesma chave.                              |
| `META_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID` | Apenas sinalizam disponibilidade no DTO de integrações; não constituem um fluxo completo de Embedded Signup implementado. |

Os três segredos têm funções distintas: App Secret verifica assinaturas; verify token verifica a inscrição do webhook; access token autoriza chamadas da conta. O access token é cadastrado por `WhatsAppAccount`, associado a `companyId`, e armazenado com AES-256-GCM. Não existe variável global de access token. Não publique segredos em comandos, logs ou tickets.

Na empresa ativa, use **Integrações** (`/app/integrations`) com permissão `integrations:manage`:

1. Cadastre `phoneNumberId`, token de acesso e, para sincronizar templates, `wabaId`. O backend consulta informações do número antes de gravar. O mesmo `phoneNumberId` não pode pertencer a duas empresas.
2. Execute a verificação do número e confira `status`, `qualityRating` e `lastError`. `CONNECTED` significa que a consulta funcionou; não comprova recebimento ou entrega de mensagens.
3. Sincronize os templates e confira nome, idioma e estado `APPROVED`.
4. Configure a entrega externa ao endpoint público e teste o recebimento. O vínculo entre número e empresa é resolvido no backend pelo `metadata.phone_number_id` do webhook.
5. Ative a IA somente após configurar atendimento humano, horários, catálogo e regras em [AI_AGENT](AI_AGENT.md).

Contratos equivalentes: `POST /api/app/integrations/whatsapp/accounts`, `PATCH /.../accounts/:id`, `POST /.../accounts/:id/verify` e `POST /.../accounts/:id/templates/sync`. Exigem sessão, empresa ativa e proteção CSRF. Consulte as [rotas](../apps/api/src/modules/company/integrations/routes.ts) e o [serviço](../apps/api/src/modules/company/integrations/service.ts). Para trocar token, atualize a conta e verifique novamente; preserve a chave que permite ler os tokens já gravados.

## Webhook e processamento

O [endpoint](../apps/api/src/modules/webhooks/routes.ts) fica fora do prefixo `/api`:

- `GET /webhooks/whatsapp`: aceita `hub.mode=subscribe`, `hub.verify_token` correto e `hub.challenge`; devolve o challenge em texto. Token incorreto retorna 403; configuração ausente retorna 503.
- `POST /webhooks/whatsapp`: valida `X-Hub-Signature-256` como HMAC-SHA256 do **corpo bruto** com App Secret, em tempo constante. Assinatura inválida retorna 401 sem persistir evento; secret ausente retorna 503.
- Cada mensagem/status válido vira um `WebhookEvent`; o retorno 200 contém contagem e `outcomes` (`queued`, `duplicate`, `unknown_number`, `unsupported`, `without_phone`). Payload sem eventos reconhecidos pode retornar 200 com `received: 0`.

Fluxo implementado: webhook → persistência → `webhook.process` → contato/conversa/mensagem → `media.process`, se necessário → `agent.reply` → mensagem `QUEUED` → `message.send` → `SENT` → webhooks `DELIVERED`/`READ` ou `FAILED`. API e worker precisam estar ativos e compartilhar banco, Redis, providers e criptografia.

Veja [persistência de eventos](../apps/api/src/modules/webhooks/service.ts), [entrada](../apps/api/src/modules/messaging/inbound.ts), [envio](../apps/api/src/modules/messaging/outbound.ts) e [status](../apps/api/src/modules/messaging/status.ts). `SENT` indica aceitação pelo provider; entrega e leitura dependem de eventos posteriores. Status antigos não fazem `READ` regredir para `DELIVERED`; `FAILED` não volta a sucesso nesse processador.

O parser recebe texto, imagem, áudio, vídeo, documento, sticker, localização, contatos, respostas interativas, botão e reação. Reações são registradas sem disparar IA. Receber um tipo não significa que a IA analisa seu conteúdo integral. Mídias são copiadas para storage por empresa; o limite interno do download é 100 MiB. Áudio depende de STT (`none`, `mock`, `openai-compatible`); com `none`, fica sem transcrição e o agente recebe essa indicação. Veja [mídia](../apps/api/src/modules/messaging/media.ts). O provider tem métodos de envio de mídia e marcação de leitura, mas o processador de saída do domínio envia texto e template; não presuma uso automático de todos os métodos.

### Nomes de usuário e BSUID

Desde abril de 2026, os webhooks trazem o **BSUID** (business-scoped user ID, por exemplo `BR.1349…`) em `contacts[].user_id`, `messages[].from_user_id` e `statuses[].recipient_user_id`, além de `profile.username` para quem adotou nome de usuário. A Meta **omite o telefone** (`from`/`wa_id`/`recipient_id`) quando o usuário tem nome de usuário e não houve mensagem ou ligação com o número da empresa nos últimos 30 dias, nem ele está na agenda da empresa. Veja a [documentação oficial de BSUID](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/), conferida em 2026-09-27.

Contatos são identificados por telefone (`Contact.phone`, único por empresa). Comportamento atual (D-026):

- O parser preserva `userId`/`username` quando o telefone também vem; um contato sem `wa_id` não invalida as outras mensagens da mesma alteração. Status sem telefone mantém `recipientUserId`.
- Mensagem **sem telefone** vira `message_without_phone`. Ela é gravada como `WebhookEvent` `IGNORED`, com empresa e payload completo, sem job. Também gera `ErrorLog` `whatsapp_message_without_phone` (sem o texto) e log `warn`. **O cliente não recebe resposta automática.** Antes, o evento era descartado pelo parser.
- Identificação e envio por BSUID (`recipient` no lugar de `to`, disponível desde julho de 2026), vínculo com o contato por telefone, troca de número (`user_id_update`) e reprocessamento dos eventos retidos exigem migração de `Contact`. Isso é uma decisão pendente em [PROGRESS](../PROGRESS.md).

## Janela de 24h, templates e atendimento humano

A regra local de [window.ts](../packages/whatsapp/src/window.ts) permite texto livre somente antes de `lastInboundAt + 24h`; sem mensagem anterior ou no instante da expiração, exige template. Essa exigência corresponde à [política oficial de mensagens](https://whatsappbusiness.com/policy/), consultada em 2026-09-26. O código não calcula cobrança da Meta; consulte os [preços oficiais](https://whatsappbusiness.com/products/platform-pricing/) para a conta e categoria aplicáveis.

**Mudança de preço em 2026-10-01** ([preços de mensagens sem template](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages), conferido em 2026-09-27): a Meta passa a cobrar **cada mensagem de serviço** (texto livre na janela de 24h, portanto cada resposta da IA ou da equipe) ao preço de utility/autenticação do mercado, sem faixas de volume. Templates utility dentro da janela deixam de ser gratuitos. No Brasil, a referência citada pela Meta para utility é 0,68 centavo de dólar por mensagem (tabela de 2026-07-01). A cobrança informada pela Meta no primeiro status com `pricing` é gravada na mensagem (`billable`, `pricingCategory`, `pricingModel`), mesmo quando o status chega fora de ordem. O relatório de consumo (`/api/platform/usage/breakdown` e `/api/app/metrics/usage/breakdown`) soma as mensagens cobráveis por dia, cliente e categoria. O custo usa a tabela de referência de [pricing.ts](../packages/whatsapp/src/pricing.ts) (US$ 0,0068 para service/utility/authentication, mercado Brasil) mais `WHATSAPP_PRICE_USD`. Categorias sem preço, como marketing, ficam sem custo e aparecem como `whatsappUnpricedMessages`. A tabela assume um único mercado (Brasil) (D-033). O agrupamento de mensagens do cliente (buffer) reduz respostas, mas cada mensagem enviada é cobrada.

`queueOutboundText` bloqueia texto fora da janela e contatos com `optedOut`. O worker revalida janela, opt-out e estado da empresa antes de chamar o provider; `SUSPENDED`/`CANCELLED` bloqueiam novos envios, inclusive templates. Um bloqueio posterior ao enqueue marca a mensagem `FAILED` com `send_blocked`, sem envio nem métrica de mensagem enviada. Aceite externo já persistido continua reparando efeitos locais, sem reenviar. Templates exigem cadastro local com nome/idioma e estado `APPROVED`, além de contato sem opt-out. O fluxo de envio do painel suporta parâmetros textuais do corpo. Templates não reabrem por si a janela local; uma nova mensagem do cliente a atualiza. O canal `TEST` tem comportamento próprio, sem envio real.

O [handoff](../apps/api/src/modules/messaging/handoff.ts) muda a conversa para `HUMAN`/`WAITING_HUMAN`, registra motivo e notificação. O atendente pode assumir, responder e devolver à IA. A devolução marca entradas anteriores como tratadas e agenda resumo; não responde novamente a todo o período humano. Notas `SYSTEM` são internas. Pausar/retomar também não equivale a reenviar o histórico pendente.

## Falhas, retries e limites de idempotência

| Job               | Tentativas totais | Backoff exponencial inicial |
| ----------------- | ----------------- | --------------------------- |
| `webhook.process` | 5                 | 2 s                         |
| `message.send`    | 4                 | 3 s                         |
| `media.process`   | 4                 | 5 s                         |
| `agent.reply`     | 3                 | 5 s                         |

São políticas de [fila](../apps/api/src/queues/types.ts), não promessa de repetir qualquer erro. Rede, HTTP 429/5xx e códigos transitórios mapeados (`1`, `2`, `4`, `80007`, `130429`, `131000`, `131016`, `131056`, `131057`, `133004`) são repetíveis no provider, conforme a [tabela oficial de erros](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) conferida em 2026-09-27. Exigem ação: token inválido (`0`/`190`), janela fechada (`131047`), qualidade/spam (`131048`), limite de marketing por usuário (`131049`, aguardar 24h), opt-out de marketing (`131050`), pagamento (`131042`), conta bloqueada/restrita (`131031`/`368`), destinatário só com BSUID (`131062`) e templates (`132000`/`132001`/`132015`/`132016`). Esses códigos exibem orientação em português. No envio, erro definitivo marca `Message.FAILED`, sinaliza a conversa e registra notificação/erro; o processador pode terminar normalmente mesmo com a mensagem falhada. Inspecione também o estado do domínio, além de jobs falhados. Jobs concluídos têm retenção limitada a 24h/1.000 itens; falhados a 7 dias/5.000, conforme [BullMQ](../apps/api/src/queues/bullmq.ts).

A deduplicação usa `(provider, dedupeKey)` — `wamid` para mensagem e `wamid:status` para status —, `Message.externalId` por empresa, IDs de jobs e estado no banco. Isso protege as repetições comuns cobertas pelos testes, mas **não garante exatamente um envio**:

- Banco e Redis continuam separados. Webhooks `RECEIVED`/`PROCESSING` são reenfileirados na reentrega com o mesmo ID. A ingestão confirma seus efeitos no banco e a outbox numa transação; retries de mensagem já existente reconstituem jobs pendentes, sem duplicar contadores ou leads. Isso depende de reentrega/retry: não há varredura global de reconciliação nem backfill de registros parciais anteriores a esta correção.
- `FAILED` segue os retries limitados do worker. Quando esgotados, o BullMQ retém o job e ignora novo `add` com o mesmo ID; reentrega não reinicia tentativas. É necessária intervenção/replay controlado, cuja interface operacional ainda não existe. O mesmo limite vale para jobs de domínio retidos como falhos.
- Se a Meta aceitar o envio e a resposta se perder, uma tentativa posterior pode reenviar. Antes de reprocessamento manual, reconcilie mensagem, IDs externos e evidência da Meta; não apague registros de deduplicação para forçar retry.
- Quando o aceite/ID externo já foi persistido, retries só recuperam consumo/outbox e sua publicação; falha local posterior não muda o envio para `FAILED` nem chama o provider novamente. Mídias finalizadas também retomam agendamento sem novo download. Esses limites são cobertos em [messaging-effects.test.ts](../apps/api/test/messaging-effects.test.ts). Falha antes de persistir o ID aceito continua sendo resultado externo incerto.
- `lastInboundAt` usa o timestamp original da entrada, limitado à hora de ingestão se vier no futuro. Eventos antigos não fazem janela, preview ou última interação regredirem. A revalidação do worker ocorre antes da chamada externa, não pode revogar um envio que o provider já iniciou. Veja [testes de janela/consentimento](../apps/api/test/messaging-safety.test.ts).
- A sincronização lê até 200 templates sem paginação. A chave local é empresa/nome/idioma e a seleção de envio não filtra a conta; empresas com múltiplas WABAs precisam de validação específica.

Para diagnóstico, confira `lastWebhookAt`, `WebhookEvent.status/attempts/error`, `Message.status/errorCode/errorMessage`, `MediaAsset.processingStatus/processingError`, notificações e saúde das filas. `unknown_number` é resolvido cadastrando o número correto, mas o evento já ignorado não será automaticamente reproduzido. Não há botão/API genérica de replay documentado no contrato atual.

## Simulação e testes sem credenciais externas

Use `NODE_ENV=development`, `WHATSAPP_PROVIDER=mock` e `AI_PROVIDER=mock` com banco e Redis locais. Em Integrações, o simulador chama `POST /api/app/integrations/whatsapp/simulate` com `{ "from": "5511999990000", "name": "Cliente de teste", "text": "Olá" }`. Ele cria dados na empresa e segue ingestão, filas e agente, mas **não testa assinatura nem transporte do webhook**. Fora de `mock`, o endpoint recusa a simulação. Não o use com dados reais que precise preservar.

```bash
pnpm --filter @botsaas/whatsapp test
pnpm --filter @botsaas/api exec vitest run test/webhook.test.ts test/agent-flow.test.ts test/providers.test.ts
```

Prepare o banco descartável conforme [VALIDATION](VALIDATION.md). Os [testes de webhook](../apps/api/test/webhook.test.ts) verificam assinatura, deduplicação, identificação da empresa e status; os [testes de fluxo](../apps/api/test/agent-flow.test.ts) verificam buffer, envio mock, handoff, retries de IA e janela. Os [testes de recuperação](../apps/api/test/webhook-recovery.test.ts) cobrem falhas de enqueue, retry após commit, concorrência, rollback e mensagens já tratadas. `pnpm test:e2e` usa API/worker/painel reais com providers simulados. Isso não comprova entrega pela Meta, recuperação de desastre ou envio externo exatamente uma vez.

## Homologação real pendente

### Etapa 1 — conferência automatizada da conta

Com um token de System User com `whatsapp_business_messaging` e `whatsapp_business_management`:

```bash
HOMOLOG_WA_ACCESS_TOKEN=... HOMOLOG_WA_PHONE_NUMBER_ID=... HOMOLOG_WA_WABA_ID=... \
WHATSAPP_GRAPH_API_VERSION=v26.0 pnpm homolog:whatsapp [--send-to=5511999999999] [--template=hello_world --lang=en_US]
```

O [script](../apps/api/scripts/homolog-whatsapp.ts) não acessa banco nem Redis e não imprime o token. A [rotina](../packages/whatsapp/src/homologation.ts) confere se `API_PUBLIC_URL` é HTTPS público e se o App Secret e o verify token estão definidos. Depois valida token e número (`quality_rating`), a inscrição do app nos webhooks da WABA (`GET /<WABA>/subscribed_apps`; sem ela, a Meta não entrega mensagens) e os templates aprovados. Somente com `--send-to`, envia **um** template ao número de teste. Falhas mostram HTTP, código Graph e `fbtrace_id`. Os [testes do cliente](../packages/whatsapp/test/cloud-api.test.ts) e da [rotina](../packages/whatsapp/test/homologation.test.ts) cobrem os mesmos formatos sem rede.

### Etapa 2 — cenários ponta a ponta

Pré-requisitos: ambiente isolado acessível por HTTPS, credenciais oficiais da conta de teste com acesso ao número/WABA, destinatários de teste autorizados, templates aprovados, banco/Redis/storage disponíveis, operador humano e limite de gasto definido. A configuração externa da conta e assinatura do webhook deve ser conferida na documentação da Meta para a versão escolhida; não foi executada nesta sessão.

| Verificação a executar                         | Critério de aceite e evidência                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verificar inscrição e assinatura               | Challenge aceito; POST válido recebido; assinatura adulterada rejeitada sem evento. Registrar horário e IDs, sem segredos.                        |
| Enviar mensagem do aparelho de teste           | Um evento e uma entrada na empresa correta; resposta recebida no aparelho; ID externo e status de entrega associados.                             |
| Repetir o mesmo webhook assinado               | Nenhuma nova mensagem ou resposta no caso normal; testar separadamente interrupção entre banco e fila.                                            |
| Texto dentro/fora da janela e template         | Texto fora da janela bloqueado; template aprovado recebido; parâmetros/idioma corretos; texto só liberado após resposta do cliente.               |
| Handoff, pausa e retorno                       | IA cessa novos turnos; equipe assume; retorno gera resumo sem responder entradas antigas. Verificar também corrida com turno já em execução.      |
| Token inválido, rede, mídia e status           | Erros visíveis, retries limitados, nenhuma perda silenciosa; áudio com/sem STT e imagem refletem o conteúdo disponível.                           |
| Dois tenants e múltiplos números               | Mensagens, tokens, templates e status permanecem associados à conta/empresa correta.                                                              |
| Usuário com nome de usuário                    | Mensagem de conta sem interação recente fica `message_without_phone` com `ErrorLog`; quem já interagiu segue o fluxo normal com BSUID preservado. |
| Cobrança por mensagem (a partir de 2026-10-01) | Status `delivered` traz `pricing` coerente com a categoria; conferir no WhatsApp Manager o custo das respostas de serviço.                        |

Registre versão Graph, configuração de providers, IDs de teste, resultado observado e falhas por cenário. Só marque homologado o que tiver evidência; as limitações de atomicidade, janela e concorrência exigem tratamento antes de prometer essas garantias em produção.
