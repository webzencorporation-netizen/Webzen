# Agente de IA: configuração e operação

O agente usa a interface `AIProvider`, com Claude via `@anthropic-ai/sdk`, Muse Spark via Meta Model API (mesmo SDK, endpoint compatível) ou provider `mock`, e um loop de ferramentas controlado no backend. Configuração, histórico, memória e conhecimento são associados a `companyId`. A validação registrada em [PROGRESS](../PROGRESS.md) usa mocks; disponibilidade dos modelos, credenciais, beta e custos reais ainda precisam de homologação.

## Configuração

As variáveis globais são validadas em [env.ts](../packages/config/src/env.ts); a seleção dos providers está em [providers.ts](../apps/api/src/providers.ts).

| Variável                  | Comportamento implementado                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`             | `mock` por padrão; `anthropic` exige `ANTHROPIC_API_KEY`; `meta` exige `META_MODEL_API_KEY`. Produção recusa mock.                                   |
| `AI_DEFAULT_MODEL`        | Padrão do repositório `claude-opus-5`; aplicado quando a empresa não define modelo. Deve pertencer ao provedor ativo (com `meta`: `muse-spark-1.3`). |
| `AI_SUMMARY_MODEL`        | Modelo para resumo; se ausente, usa modelo da empresa e depois o padrão global. Também deve pertencer ao provedor ativo.                             |
| `META_MODEL_API_KEY`      | Chave da [Meta Model API](https://dev.meta.ai). Somente no `.env`/secret do ambiente; nunca vai ao painel nem a logs.                                |
| `META_MODEL_API_BASE_URL` | `https://api.meta.ai` por padrão (endpoint compatível com a Messages API).                                                                           |
| `AI_REQUEST_TIMEOUT_MS`   | 120.000 ms por requisição por padrão; não é limite total do turno.                                                                                   |
| `AI_REFUSAL_FALLBACK`     | `true` por padrão. Para IDs da lista interna, envia `fallbacks: "default"` e beta `server-side-fallback-2026-07-01`; depende de suporte externo.     |

O [adapter Anthropic](../packages/ai/src/provider/anthropic.ts) usa Messages API sem streaming, configura duas retentativas do SDK e envia `output_config.effort` conforme uma heurística de nomes de modelos. O código permite habilitar parâmetros; isso não comprova que a conta/modelo os aceita. Confirme IDs e capacidades nos [modelos oficiais](https://platform.claude.com/docs/en/models/overview), e o comportamento de recusa na [documentação oficial de stop reasons e fallback](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), consultadas em 2026-09-26. Use `AI_REFUSAL_FALLBACK=false` para homologar primeiro a chamada básica caso o beta não tenha sido validado.

Recusa e fallback seguem a [documentação oficial de refusals e fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback), conferida em 2026-09-27 (D-025):

- Recusa chega como HTTP 200 com `stop_reason: "refusal"`. O provider expõe `stop_details` como `refusal` (`category`, `explanation`, `recommendedModel`). Categoria nula é um valor válido. O runner grava `Recusa do provedor de IA (categoria: …)` em `AgentRun.errorMessage` e emite log `warn`.
- Com fallback, o `usage` de topo cobre só a tentativa que produziu a resposta; `usage.iterations` registra cada tentativa. O provider mapeia essas entradas em `attempts` (modelo, `served`, `fallback`, tokens), que o engine acumula no turno e o runner registra em log `info`. Roteamento sticky aparece como tentativa única de fallback.
- O conteúdo do assistente volta intacto na iteração seguinte do loop de tools, inclusive o bloco `fallback` na mesma posição. Sem streaming, a API omite a saída parcial recusada, então nenhum bloco precisa ser descartado.
- Tentativas recusadas **antes** do fallback não entram no custo estimado. Elas são cobradas quando produziram saída ou pertencem às categorias `bio`, `frontier_llm` e `reasoning_extraction`. A resposta final não informa a categoria de cada tentativa intermediária; a contabilização segue o [plano de custos](COST_ACCOUNTING_PLAN.md).

### Meta Model API (Muse Spark)

O [provider Meta](../packages/ai/src/provider/meta.ts) (`AI_PROVIDER=meta`, D-028) reaproveita a tradução de mensagens do adapter Anthropic, mas é um provider separado: não envia `fallbacks`/beta nem `cache_control`. Diferenças verificadas contra a API real em 2026-09-29 (repetidas por `pnpm homolog:meta`):

- Autenticação por `Authorization: Bearer`. O cliente é criado com `apiKey: null`, então o SDK nunca lê nem envia `ANTHROPIC_API_KEY` à Meta.
- O raciocínio **não pode ser desligado** (`thinking: disabled` → 400) e conta em `max_tokens` e em `output_tokens` (cobrado como saída). Por isso o provider sempre envia `output_config.effort` (`low`/`medium`/`high`; `minimal` é recusado) e soma uma folga a `maxOutputTokens`: +2.048 (`low`), +4.096 (`medium`), +8.192 (`high`). Medido: ~300–450 tokens de raciocínio em `low` e ~600–700 em `medium` numa pergunta simples. Tokens não usados não são cobrados.
- A resposta traz blocos `redacted_thinking`, reenviados intactos no loop de tools.
- `tool_choice` só aceita `auto`, que é o padrão; o provider nunca envia outro valor.
- `max_tokens` mínimo 16. Modelo inexistente responde 404 (não repetido pelo runner).
- Cache de prompt é automático (`cache_read_input_tokens`), sem marcação.
- Streaming funciona no SDK, mas o atendimento não usa streaming: a mensagem do WhatsApp é enviada inteira.
- Latência observada: 15–18 s por turno com 2–3 chamadas de ferramenta (effort `medium`).

O catálogo do painel mostra apenas os modelos do provedor ativo. Se uma empresa tiver salvo um modelo de outro provedor (ex.: `claude-opus-5` depois de trocar para `meta`), o runner, o resumo e o painel usam `AI_DEFAULT_MODEL` em vez de falhar. O modelo salvo não é apagado ([models/service.ts](../apps/api/src/modules/models/service.ts)).

A [composição dos providers](../apps/api/src/providers.ts) não troca provider real por simulação: `AI_PROVIDER=anthropic` sem chave, `STORAGE_PROVIDER=s3` sem bucket ou STT compatível sem URL/chave falham na inicialização. Com `NODE_ENV=production`, qualquer provider `mock`/`local` é recusado, mesmo que um env chegue sem a validação cruzada.

No painel da empresa (`/app/agent`), ajuste identidade, tom, regras, ferramentas, limites e mensagens de fallback; os horários pertencem à configuração da empresa. As [rotas de configuração](../apps/api/src/modules/company/ai/routes.ts) exigem `ai:configure`; preview exige `ai:prompt_preview`; teste exige `ai:test`. `companyId` vem da sessão validada, não do modelo ou do payload do painel.

| Campo por empresa                     | Padrão do schema      | Faixa aceita pela API                                           |
| ------------------------------------- | --------------------- | --------------------------------------------------------------- |
| `enabled`                             | `false`               | Booleano                                                        |
| `model`                               | `null` (herda global) | Modelo ativo do provedor atual; `null` restaura herança         |
| `messageBufferSeconds`                | 4                     | 0–30 s                                                          |
| `maxOutputTokens`                     | 1.024                 | 256–16.000 por chamada                                          |
| `effort`                              | `medium`              | `low`, `medium`, `high`                                         |
| `maxToolIterations`                   | 6                     | 1–12 iterações do engine, além dos retries internos do provider |
| `historyMessageLimit`                 | 20                    | 4–100 mensagens                                                 |
| `summaryThreshold`                    | 40                    | 10–500; agenda resumo quando excedido                           |
| `respondOutsideHours`                 | `true`                | Booleano                                                        |
| `dailyBudgetUsd` / `monthlyBudgetUsd` | `null`                | Sem orçamento próprio / valor não negativo                      |
| `fallbackBehavior`                    | `HANDOFF_TO_HUMAN`    | Handoff, mensagem de fallback ou `SILENT`                       |

São padrões do [schema](../packages/database/prisma/schema.prisma); seed/template podem estabelecer valores diferentes. Confira o DTO da empresa antes de operar. Mudanças no texto do prompt incrementam `version` e geram auditoria. O preview usa contexto de exemplo, não uma conversa real.

## Execução, buffer e fallback

O [runner](../apps/api/src/modules/agent/runner.ts) processa conversas `WHATSAPP` em modo `AI` com configuração habilitada. Relê até 30 entradas não tratadas, verifica buffer, espera mídia pendente por até 90 s, consulta limites e horário, monta contexto, executa tools e registra `AgentRun`/`UsageRecord`. A saída é enfileirada para o WhatsApp; geração bem-sucedida não comprova entrega.

Empresas `SUSPENDED`/`CANCELLED` não iniciam novos turnos automáticos nem resumos. O estado é revisto antes da primeira chamada após preparar contexto e após o resultado/erro do turno; suspensão durante a execução descarta resposta/fallback e mantém entradas pendentes. `enabled` permanece independente. O loop já iniciado e suas tools podem concluir, assim como um resumo em voo; isso não é cancelamento de todas as chamadas externas. O testador manual via suporte autorizado permanece explícito (D-023).

O [buffer](../packages/ai/src/buffer.ts) espera silêncio desde a mensagem mais recente; quando executado, permite processar se a mais antiga exceder `max(20, bufferSeconds × 4)` segundos. O debounce da fila reinicia o atraso a cada mensagem: esse limite da função não é um timer independente que interrompe uma sequência contínua antes de o job começar.

O lock por conversa é uma lease Redis `SET NX PX`, com TTL de 180 s renovado a cada 60 s por comparação do token (em memória nos testes sem Redis). Se ocupado, o runner reagenda em 3 s. A conexão dedicada limita comandos a 2 s e não herda retries/fila offline do BullMQ. Expiração monotônica, falha de renovação, fechamento da conexão ou perda do token invalidam a lease; o runner bloqueia novos efeitos de resposta/fallback/controle e novas tools após detectar a perda. A evolução do desenho de D-007 está em D-021.

O loop de IA já iniciado pode continuar até seu limite para registrar resultado e consumo, mas não publica uma resposta tardia após perda da lease. Isso não cancela tools/requests em voo nem fornece fencing com PostgreSQL: há uma janela entre checagem e escrita, e troca silenciosa do token só é detectada na renovação. A recuperação depende dos retries limitados da fila.

O [engine](../packages/ai/src/engine.ts) trata recusa, limite de iterações, texto truncado e chamadas de ferramentas. Recusa, esgotamento sem resposta ou texto vazio levam ao fallback; texto truncado não vazio pode ser enviado como resposta. Erros transitórios permitem retry de `agent.reply` (3 tentativas, backoff inicial 5 s), além dos retries internos do SDK. Erros de credencial/permissão, bad request e modelo inexistente não são repetidos pelo runner como falhas transitórias.

- `HANDOFF_TO_HUMAN`: muda a conversa para `HUMAN`/`WAITING_HUMAN` e notifica a equipe. Mensagem de handoff configurada é tentada dentro das regras de envio.
- `SEND_FALLBACK_MESSAGE`: tenta enviar a mensagem e marca atenção; não transfere necessariamente para humano.
- `SILENT`: marca atenção sem mensagem automática. As entradas são consideradas tratadas nesse fallback.
- Limite de IA atingido força handoff, independentemente da opção acima. Fora do horário, quando respostas externas ao horário estão desativadas, envia aviso com supressão de repetição por 12h e marca entradas tratadas.

O botão de emergência desativa `enabled`. O runner relê conversa/configuração e entradas pendentes depois de sucesso ou erro da IA, antes de resposta/fallback: pausa, posse humana, fechamento, exclusão ou opt-out impedem o resultado tardio. O registro e o consumo retornado pelo engine permanecem pelo fluxo existente; falhas intermediárias ainda podem perder consumo parcial. Entradas pausadas não são marcadas tratadas por esse descarte. Na devolução ao agente, mensagens anteriores são marcadas tratadas, invalidando também resultados antigos, e um resumo é agendado. O handoff solicitado pelo próprio resultado continua funcionando.

Isso não cancela requests ou tools já em andamento e ainda existe uma janela entre a releitura e a publicação. Mensagens já enfileiradas não são retiradas automaticamente por pausa; o worker revalida janela de atendimento e opt-out. Consulte [handoff](../apps/api/src/modules/messaging/handoff.ts), [testes de interrupção](../apps/api/test/agent-interruption.test.ts) e [regras de envio](WHATSAPP.md).

## Prompt, ferramentas e memória

O [prompt](../packages/ai/src/prompt.ts) combina regras universais, template do segmento, perfil, regras e estilo da empresa, seguidos do contexto volátil. O bloco estável recebe um breakpoint de cache `ephemeral`; histórico, memória e conhecimento variáveis ficam fora dele. O cache depende de requisitos externos e tamanho mínimo; não se deve prometer redução de custo em toda chamada. Referência: [prompt caching oficial](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

As [tools](../apps/api/src/modules/agent/tools.ts) consultam empresa, horários, produtos/serviços e conhecimento; atualizam contato, notas e memória; atualizam CRM; consultam/criam/remarcam/cancelam agenda; solicitam handoff. Só entram no request as tools habilitadas na empresa; ferramentas de agenda e CRM também dependem das respectivas features. Empresa e contato vêm da conversa. Remarcação/cancelamento verificam o dono do agendamento.

O [catálogo](../packages/ai/src/tools/catalog.ts) valida entradas com Zod. Criação/remarcação/cancelamento exigem `customerConfirmed: true` e o prompt exige confirmação do cliente; não existe um token de confirmação independente emitido pelo backend. O booleano ainda é fornecido pelo modelo. Preços de catálogo só são expostos quando `priceVisibleToAi` permite.

Tools pedidas na mesma resposta executam em paralelo, com timeout padrão de 20 s. Erros voltam como `tool_result` estruturado; não são convertidos em sucesso fictício. O timeout não cancela o handler subjacente. Não há deduplicação geral por ID de tool nem transação abrangendo o turno: uma escrita já concluída pode se repetir depois de falha/retry. Homologue ações de escrita e mantenha disponíveis somente as necessárias ao atendimento.

O [contexto](../apps/api/src/modules/agent/context.ts) inclui até 15 memórias do contato, resumo anterior, histórico recente, lead/campos a coletar e quatro trechos de conhecimento. A memória usa upsert por contato/chave. O [filtro de dados sensíveis](../apps/api/src/modules/company/contacts/service.ts) bloqueia padrões de CPF, CNPJ, cartão e palavra “senha”; não é detector completo de dados sensíveis nem sanitiza todo conteúdo enviado ao provedor. Blocos brutos de raciocínio são mantidos apenas no loop em memória e não gravados como histórico de chain-of-thought. Debug do teste inclui entrada/resultado das tools; trate esse conteúdo como dados da empresa.

O [resumo](../apps/api/src/modules/agent/summary.ts) cobre até 200 mensagens por execução, incorpora o resumo anterior e usa até 2.048 tokens de saída, esforço `low`. No retorno humano, também registra resumo no handoff. Histórico posterior ao `coveredUntil` é limitado pela configuração; não há memória ilimitada da conversa.

## Conhecimento e mídia

O [retriever](../apps/api/src/modules/knowledge/retriever.ts) faz full-text em português com `unaccent`, seguido de similaridade de título com `pg_trgm` quando não há resultado. Todo SQL filtra `companyId` e entradas ativas. Não há embeddings no MVP. A busca automática injeta até quatro trechos de 1.200 caracteres; `search_knowledge` retorna até cinco de 1.500 caracteres.

[Documentos](../apps/api/src/modules/company/knowledge/documents.ts) aceitam PDF com texto, TXT, MD e CSV; extração ocorre na fila, em trechos de 1.200 caracteres com sobreposição de 150, até 400 trechos. Não há OCR; PDF escaneado pode falhar. Conteúdo além do limite de trechos não entra no índice. O processador grava `FAILED` e captura a exceção; embora a fila declare três tentativas, essas falhas capturadas não disparam retry automático. Inspecione o status do documento e corrija/reenvie o arquivo quando necessário.

Imagens recebidas podem ser enviadas ao modelo: no máximo três por turno, JPEG/PNG/GIF/WebP e até 3.750.000 bytes por arquivo conforme metadados. Áudio usa transcrição separada; vídeo/documentos de mensagens não recebem análise multimodal completa. Arquivos enviados à base de conhecimento têm fluxo de extração distinto das mídias recebidas por WhatsApp.

## Modelos, preços e limites financeiros

O catálogo do painel vem de `ModelPricing.isActive`, não de descoberta automática na Anthropic. Um administrador de plataforma com `platform:pricing:write` pode cadastrar/alterar `PUT /api/platform/pricing/:model` com preços de input, output, cache write e cache read em USD por milhão de tokens. Confirme ID exato, permissões, ciclo de vida e preços nos [modelos](https://platform.claude.com/docs/en/models/overview) e [preços oficiais](https://platform.claude.com/docs/en/about-claude/pricing). Valores do seed são valores iniciais do repositório, não comprovante da tarifa contratada.

O [cálculo](../packages/ai/src/pricing.ts) soma separadamente as quatro parcelas de tokens e arredonda a seis casas. A [resolução de preço](../apps/api/src/modules/agent/pricing.ts) usa a tabela ativa, cache em memória por até 60 s e fallback na tabela de constantes. Sem correspondência exata retorna custo **zero**, inclusive para um ID versionado retornado pelo provider sem preço cadastrado. Desativar um modelo na seleção não remove automaticamente uma configuração já gravada, nem impede o fallback de preço das constantes.

O custo agregado de um turno usa o primeiro modelo retornado pelo engine, mesmo se mais de um modelo participou. Tentativas recusadas antes de um fallback ficam em `attempts` e nos logs, mas não no custo estimado. Uma execução que falha após chamadas intermediárias registra falha, mas não persiste todo o consumo parcial. São estimativas operacionais; reconcilie com a cobrança externa. Não incluem WhatsApp, STT, storage ou calendário.

O resumo registra o consumo observado imediatamente após a resposta do provider, antes de descartar texto vazio ou persistir o resumo. Assim, texto vazio/recusa sem texto e falha posterior de gravação não apagam essa evidência. Erro do provider sem métricas não gera consumo inventado; falha entre resposta externa e persistência continua sendo um limite. A evolução completa de custos desconhecidos está em [COST_ACCOUNTING_PLAN.md](COST_ACCOUNTING_PLAN.md).

Os [limites](../apps/api/src/modules/usage/limits.ts) usam sobrescrita da empresa > plano > ilimitado. Antes de novos turnos automáticos, verificam chamadas/custo mensal e orçamentos diário/mensal no fuso da empresa. Uma “chamada” nessa métrica é um `UsageRecord` de turno/resumo, não cada request do loop. Não há reserva atômica de orçamento ou corte no meio do turno: concorrência e chamadas em andamento podem ultrapassar o valor. Teste do painel e resumo não passam por essa checagem prévia. Custo de teste entra nos agregados de custo, embora suas chamadas estejam excluídas da contagem mensal de chamadas não teste.

## Simulação e validação local

O teste do painel (`POST /api/app/ai/test`) usa o provider selecionado, mesmo com IA da empresa desativada. Com `anthropic` ou `meta`, ele faz chamada real e pode gerar custo. Para testar sem serviços externos, use `AI_PROVIDER=mock`, `WHATSAPP_PROVIDER=mock`, storage local e STT `none`/`mock` em desenvolvimento. O [mock](../packages/ai/src/provider/mock.ts) é determinístico e também aceita respostas roteirizadas nos testes; não mede a qualidade de linguagem do Claude.

O [chat de teste](../apps/api/src/modules/agent/test-chat.ts) cria contato/conversa `TEST`, mensagens e registros de execução/uso. Não envia ao WhatsApp; as escritas das tools são simuladas, mas as leituras usam dados da empresa ativa. Debug mostra modelo, tokens, estimativa, duração, conhecimento, tools e handoff. Não testa buffer, limite financeiro prévio ou transporte externo. Reset remove o contato de teste associado ao usuário.

```bash
pnpm --filter @botsaas/ai test
pnpm --filter @botsaas/api exec vitest run test/agent-flow.test.ts test/company-panel.test.ts test/providers.test.ts
```

Prepare PostgreSQL descartável conforme [VALIDATION](VALIDATION.md). Os [testes unitários](../packages/ai/test/engine.test.ts) exercitam loop, validação, recusa, limite de iterações e autorização; os [testes integrados](../apps/api/test/agent-flow.test.ts) cobrem buffer, tools, consumo, handoff, retry, limite e isolamento de conhecimento. E2E testa o painel com providers simulados. Consulte o registro da execução em [PROGRESS](../PROGRESS.md); este guia não representa nova execução de APIs pagas.

## Homologação real pendente

### Etapa 1 — homologação automatizada do provider

Com `ANTHROPIC_API_KEY`, `AI_DEFAULT_MODEL` e, se usado, `AI_SUMMARY_MODEL` no ambiente ou no `.env`:

```bash
pnpm homolog:anthropic           # modelos, preço local, resposta simples e tool use
pnpm homolog:anthropic --cache   # também confirma prompt caching (~12 mil tokens de entrada)
```

O [script](../apps/api/scripts/homolog-anthropic.ts) não acessa banco, Redis nem WhatsApp. A [rotina](../packages/ai/src/homologation.ts) usa o mesmo `AnthropicProvider` e `AgentEngine` do atendimento. Ela verifica, pela Models API, se cada modelo configurado existe para a conta e se ele tem preço na tabela padrão; ausência de preço gera aviso. Depois executa uma resposta simples (`effort: low`) e um ciclo completo de tool use, que devolve os blocos de raciocínio da iteração anterior. O relatório lista status, modelo que atendeu (inclusive fallback), consumo e custo estimado, sem imprimir a chave. O código de saída é 1 se alguma verificação falhar. Credencial inválida reprova antes das chamadas pagas.

A etapa comprova credencial, IDs, parâmetros (`output_config.effort`, `fallbacks`/beta quando habilitado, `cache_control`) e o formato das respostas. Ela não substitui os cenários de negócio abaixo. Os [testes de contrato](../packages/ai/test/anthropic-provider.test.ts) cobrem o mesmo formato com o SDK real contra um servidor HTTP local.

### Etapa 1 (Meta) — homologação automatizada do Muse Spark

Com `META_MODEL_API_KEY` e `AI_DEFAULT_MODEL=muse-spark-1.3` no ambiente ou no `.env`:

```bash
pnpm homolog:meta
```

O [script](../apps/api/scripts/homolog-meta.ts) não acessa banco, Redis nem WhatsApp. A [rotina](../packages/ai/src/homologation-meta.ts) usa `MetaModelProvider` + `AgentEngine`. Ela verifica modelo e preço, conversa normal e `effort` `low`/`medium`/`high` (e que `thinking: disabled` continua recusado). Também cobre tool calling completo, duas ferramentas no mesmo turno, limite de tokens (`max_tokens=16` → `max_tokens`; abaixo de 16 → 400), streaming e `tool_choice` (`auto` aceito; `any`/`tool` recusados). Por fim, confere os erros 401 (chave inválida) e 404 (modelo inexistente), ambos não repetíveis. 429/5xx não são provocados na API real e ficam nos [testes de contrato](../packages/ai/test/meta-provider.test.ts). Custo típico: ~US$ 0,01 por execução. Quando a Meta passar a aceitar algo hoje recusado, a verificação vira aviso para revisar o provider.

### Etapa 2 — cenários de atendimento

Pré-requisitos: credencial Anthropic fornecida pelo responsável, orçamento autorizado e monitorado também no provedor, empresa isolada com dados sintéticos, modelo/preços conferidos, operador para handoff e acesso a logs sem segredos. Comece com WhatsApp mock; habilite Meta real somente para o checklist de [WHATSAPP](WHATSAPP.md).

| Cenário a executar                          | Critério de aceite                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chamada básica e escolha de modelo          | Request aceito; ID realmente retornado possui preço local; texto, tokens e execução registrados.                                                                         |
| Effort, cache e fallback de recusa          | Parâmetros aceitos no modelo/conta; campos de uso observados; recusa encaminhada conforme configuração. Não afirmar beta homologado sem evidência.                       |
| Catálogo, conhecimento e informação ausente | Resposta fiel aos dados; preço oculto não exposto; ausência reconhecida; conteúdo de outra empresa não recuperado.                                                       |
| Agenda e CRM                                | Cliente confirma; uma ação válida efetivada; agendamento alheio rejeitado; dry-run do painel não altera recursos de negócio.                                             |
| Memória, resumo e handoff                   | Preferência reaparece; dados proibidos são rejeitados pelos filtros; retorno humano preserva contexto sem responder backlog.                                             |
| Erros e orçamento                           | Credencial inválida/modelo inexistente visíveis; retry transitório limitado; limite já atingido impede novo turno automático e encaminha à equipe.                       |
| Concorrência e interrupções                 | Avaliar turno >180 s, emergência durante chamada, timeout após escrita e retry após falha parcial; registrar/reparar duplicações antes de liberar garantias de produção. |

Guarde configuração efetiva, ID do modelo retornado, IDs de execução, consumo observado e resultado por cenário. Nenhum desses critérios comprova sozinho qualidade para todos os atendimentos; libere o conjunto de tools e situações efetivamente avaliado.
