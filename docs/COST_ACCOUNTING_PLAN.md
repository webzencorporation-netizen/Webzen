# Proposta: contabilização de custos desconhecidos da IA

**Status: proposta pendente, não implementada e não aprovada como ADR.** Análise do código em 27/09/2026. Este documento descreve uma etapa futura; não altera o comportamento atual nem comprova homologação de preços, modelos ou faturamento externo.

O objetivo é preservar o consumo observado e distinguir custo estimado, custo desconhecido e custo zero, inclusive em turnos com modelos diferentes. A proposta não cadastra preços novos, não transforma estimativas em cobrança e não recalcula o passado com preços atuais.

## Comportamento implementado e problema

| Caminho atual                                                                                              | Comportamento observado                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Estimativa do pacote AI](../packages/ai/src/pricing.ts)                                                   | `estimateCostUsd` retorna `0` quando não recebe preço. A tabela default contém estimativas iniciais, sem versionamento histórico.                                                                                                       |
| [Resolução de preços](../apps/api/src/modules/agent/pricing.ts)                                            | Consulta registros ativos, mantém cache de 60 segundos e usa defaults quando não encontra modelo. Um registro desativado também pode cair no default porque não entra no cache.                                                         |
| [Engine](../packages/ai/src/engine.ts)                                                                     | Soma tokens de todas as respostas e guarda os nomes em `modelsUsed`, sem distribuir uso por modelo. Uma exceção posterior interrompe o retorno do consumo acumulado.                                                                    |
| [Runner](../apps/api/src/modules/agent/runner.ts)                                                          | Aplica o preço do primeiro modelo observado a todo o uso. Grava um `UsageRecord` por turno concluído, inclusive outcomes de recusa ou limite de iterações. O caminho de exceção registra falha do `AgentRun`, sem gravar o uso parcial. |
| [Resumo](../apps/api/src/modules/agent/summary.ts)                                                         | Calcula custo pelo modelo retornado e registra consumo antes de verificar texto vazio/persistir resumo (correção pontual D-024). Consumo e resumo continuam em operações separadas.                                                     |
| [Schema](../packages/database/prisma/schema.prisma)                                                        | `AgentRun.estimatedCostUsd` e `UsageRecord.costUsd` são decimais obrigatórios com default zero. `UsageRecord` não identifica o provider diretamente.                                                                                    |
| [Relatórios](../apps/api/src/modules/usage/report.ts) e [limites](../apps/api/src/modules/usage/limits.ts) | Somam custos e convertem soma ausente em zero. Não indicam estimativa incompleta; budgets podem continuar liberando chamadas com consumo sem preço.                                                                                     |
| [Mock](../packages/ai/src/provider/mock.ts)                                                                | Produz tokens simulados e devolve o nome do modelo solicitado. O runner atual ainda aplica a tabela de preços a esses tokens; o nome do modelo sozinho não identifica simulação.                                                        |

O [adapter Anthropic](../packages/ai/src/provider/anthropic.ts) expõe o modelo e o uso retornados pelo provider. A contabilização proposta deve usar esses dados observados. Não se deve inventar a divisão de consumo de eventuais tentativas internas do provider que não constem da resposta.

## Contrato proposto

| Situação                                   | Custo e apresentação propostos                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Modelo com preço configurado/resolvido     | Estimativa numérica, acompanhada da origem/tabela utilizada.                             |
| Preço explicitamente zero                  | `0`, com origem do preço identificada; não confundir com ausência.                       |
| Provider `mock`                            | `0` com identificação de simulação, preservando os tokens simulados.                     |
| Preço ausente, desativado ou não resolvido | `null`, com motivo registrado; tokens e chamadas continuam contabilizados.               |
| Turno com algum modelo sem preço           | Total `null`; subtotal conhecido e componentes desconhecidos disponíveis separadamente.  |
| Período sem chamadas                       | Total e subtotal zero, sem pendências de preço.                                          |
| Histórico sem evidência suficiente         | Classificação explícita de legado não verificável; não apresentar como custo confirmado. |

`isTest` não significa provider mock: o [testador](../apps/api/src/modules/agent/test-chat.ts) simula as escritas das tools, mas pode chamar um provider real. Testes com provider real devem manter custo e consumo reais observados.

## Implementação proposta

1. **Resolver preço sem produzir zero implícito.** Alterar `estimateCostUsd`/`costFor` para `number | null` e conservar a aritmética existente para preços conhecidos. Distinguir ausência de cadastro de registro explicitamente inativo; este último não deve recuperar o default. Preservar a possibilidade de preço zero. A atualização em [rotas de pricing](../apps/api/src/modules/platform/routes.ts) deve invalidar o cache ou documentar a defasagem aceita, sem recalcular registros antigos.

2. **Distribuir uso pelo modelo efetivo.** Acrescentar ao resultado do engine um detalhamento com o uso de cada `response.model`, conservando o total de tokens e `modelsUsed`. Precificar cada componente e depois somar. Manter uma `UsageRecord` por turno e a contagem atual de atendimentos; dividir em várias linhas sem ajustar contagens alteraria os limites existentes. Resumos continuam sendo uma operação de consumo separada.

   **Entrada disponível desde 2026-09-27 (D-025):** `AgentRunResult.attempts` traz cada tentativa do provider (modelo, `served`, `fallback` e tokens), inclusive as recusadas que antecederam um fallback server-side, que o `usage` de topo da API não inclui. Uma tentativa recusada antes de qualquer saída só é cobrada nas categorias `bio`, `frontier_llm` e `reasoning_extraction`, e a resposta final não informa a categoria das tentativas intermediárias. Portanto, essas tentativas precisam de custo "incerto" explícito, sem assumir zero nem cobrança integral. Tentativas que produziram saída são cobradas.

3. **Persistir custo desconhecido e evidência.** Tornar os dois campos de custo opcionais e remover o default zero para novas gravações que exijam contabilização explícita. Propor um detalhamento em JSON no registro de uso contendo provider, modelo efetivo, tokens por categoria, origem/valores dos preços aplicados, custo ou motivo da ausência e versão do formato. O `AgentRun` pode manter o total nullable e referenciar o detalhamento pelo vínculo existente. Preservar `quantity`, `isTest`, tenant e identificadores; não colocar prompts, respostas, tokens de autenticação ou outros segredos nesse JSON. Registros de consumo não relacionados à IA precisam de uma política explícita para seu custo, sem depender da remoção do default.

4. **Não perder consumo por outcome ou erro parcial.** Preservar a correção pontual D-024: resumo já registra o uso observado antes de texto vazio/recusa sem texto e falha de gravação do resumo. No engine, ainda falta transportar o consumo já observado quando uma iteração posterior falhar, por exemplo com callback assíncrono por resposta ou erro tipado contendo o acumulado. A escolha deve preservar o tipo/código/retryability da causa original. No runner, gravar estado final e consumo parcial de forma coerente, sem emitir resposta após falha. O erro de pricing não deve descartar tokens já observados. Uma nova tentativa que faz nova chamada externa representa novo consumo; não deve sobrescrever a tentativa anterior.

5. **Relatar totais incompletos.** Retornar `costUsd: number | null`, subtotal conhecido e contagem de registros com custo desconhecido em agregados por período, conversa e empresa. Calcular a média total somente quando completa; não dividir subtotal conhecido por todas as conversas e chamá-lo de média total. Em rankings, identificar incompletude: ordenar pelo subtotal conhecido não demonstra quais foram as conversas mais caras.

6. **Aplicar budgets sem assumir gasto zero.** Se existe limite monetário diário/mensal aplicável e há custo desconhecido no mesmo período, impedir novas chamadas automáticas com motivo explícito e encaminhamento humano já utilizado pelo produto. Validar também preço do modelo planejado antes da chamada. Um modelo inesperado retornado pelo provider deve ter o uso registrado; se não tiver preço, a chamada já ocorrida fica desconhecida e as próximas decisões usam essa pendência. Não afirmar que essa checagem reserva orçamento ou impede ultrapassagem por chamadas concorrentes. Aplicar política equivalente a resumo e testador real, hoje fora da checagem automática do runner. Limites de contagem e empresas sem budget monetário não devem receber custo fictício.

## Migração e compatibilidade

1. Definir o formato/versionamento do detalhamento, a classificação de legado e a política de bloqueio antes de implementar. Formalizar a decisão somente após revisão; este plano não substitui a ADR.
2. Criar migração nova e regenerar Prisma; não editar a [migração inicial](../packages/database/prisma/migrations/20260927003504_init/migration.sql). Adicionar os campos de evidência e permitir `NULL` nos custos. Ensaiar em banco descartável com registros antigos, mocks e tipos de uso diferentes.
3. Coordenar rollout de API, workers e UI: consumidores atuais tipam custos como número e vários usam `?? 0`. A expansão do schema pode anteceder o código, mas workers antigos não devem continuar produzindo zeros ambíguos após a mudança sem identificação. Planejar uma breve parada dos produtores ou versionar as gravações; não prometer compatibilidade irrestrita entre versões.
4. Marcar a origem dos registros novos. Preservar os valores históricos originais e introduzir a classificação de legado sem apagar evidências. Definir uma rotina revisável para classificações comprováveis; não executar backfill cego que transforme todo zero em desconhecido ou todo zero em gratuito.
5. Rollback de aplicação deve conservar novos campos e `NULL`. Voltar ao schema obrigatório exige uma política explícita de conversão e perderia informação; não usar zero como rollback automático.

### Limitações dos zeros históricos

Um zero já gravado pode representar preço ausente, preço configurado como zero, arredondamento de uma estimativa pequena ou execução com tokens simulados. `AgentRun.provider` ajuda quando há vínculo, mas `UsageRecord` de resumo não contém essa evidência. O cadastro de preços atual não prova o preço vigente no instante antigo.

Também não há distribuição histórica de tokens entre modelos de um turno: mesmo um custo positivo pode ter sido calculado pelo primeiro modelo para uso de vários modelos. Não é possível reparar essa divisão a partir de tokens totais e um único modelo persistido. Preservar valores antigos como estimativas legadas, com ressalva de qualidade; reconciliação exige evidência externa ou informação histórica adicional.

Bloquear budgets com base em legado não verificável pode interromper empresas após a migração. A política de transição deve ser explícita, por período/empresa e auditável, sem silenciosamente declarar esse legado gratuito ou íntegro.

## Consumidores a atualizar

- Backend: [relatórios de uso](../apps/api/src/modules/usage/report.ts), [limites e budgets](../apps/api/src/modules/usage/limits.ts), [overview](../apps/api/src/modules/metrics/service.ts), [listagem de empresas](../apps/api/src/modules/platform/companies.service.ts), [rotas de métricas](../apps/api/src/modules/company/metrics/routes.ts), [plataforma](../apps/api/src/modules/platform/routes.ts) e [debug do testador](../apps/api/src/modules/agent/test-chat.ts).
- UI: [métricas](../apps/web/src/features/metrics/metrics-page.tsx), [uso da plataforma](../apps/web/src/features/platform/usage-page.tsx), [empresas](../apps/web/src/features/platform/companies-page.tsx), [overview](../apps/web/src/app/app/page.tsx) e [testador](../apps/web/src/features/agent/agent-tester.tsx). `formatUsd` em [format.ts](../apps/web/src/lib/format.ts) já aceita `null`, mas exibir apenas “—” não explica uma estimativa parcial; usar texto explícito de indisponibilidade ou pendência.
- Contratos de estado de limite precisam indicar incompletude, sem reutilizar `NORMAL` para gasto monetário que não pode ser avaliado.

## Testes e critérios de aceite propostos

Todos os testes de provider usam mocks ou respostas injetadas; não precisam de APIs pagas nem credenciais reais. Testes Prisma/migração precisam de PostgreSQL descartável, conforme [validação local](VALIDATION.md).

| Área         | Cenários mínimos                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pricing      | Ausente versus zero explícito; registro inativo; default permitido apenas na condição definida; cache invalidado; categorias de cache preservadas; arredondamento.                                            |
| Engine       | Duas respostas com modelos/preços diferentes; mesmo modelo em várias iterações; um componente desconhecido; uso parcial antes de exceção; causa e retryability preservadas.                                   |
| Persistência | Tokens, custo nullable e evidência coerentes; provider mock separado de `isTest`; falha posterior não apaga consumo já conhecido; nova tentativa não sobrescreve a anterior.                                  |
| Resumo       | Texto normal, vazio e recusa contabilizados; modelo de resumo distinto; falha de atualização do resumo após resposta não silencia consumo.                                                                    |
| Agregados    | Nenhuma chamada; apenas zero explícito; apenas desconhecido; mistura conhecido/desconhecido; médias e rankings incompletos identificados; isolamento tenant e filtros de testes preservados.                  |
| Budgets      | Diário/mensal com pendência somente no período pertinente; custo desconhecido anterior ao período; ausência de budget monetário; bloqueio e motivo antes da próxima chamada; resumo/testador real abrangidos. |
| Migração/UI  | Registros legados preservados e classificados sem inferência de preço; campos nullable em todos os consumidores; nenhuma tela exibe desconhecido como zero; testes de tipos e build.                          |

Ampliar [testes do engine](../packages/ai/test/engine.test.ts), [unidades AI](../packages/ai/test/units.test.ts), [fluxo do agente](../apps/api/test/agent-flow.test.ts) e criar suítes específicas para pricing, relatórios, budgets e migração. Revalidar interrupção/lease para que a persistência de consumo não reabra envio ou tools bloqueados. Rodar lint, typecheck, testes pertinentes, build e smoke antes de declarar a etapa concluída.

## Escopo e limites da etapa

Estimativa preliminar: 15–20 arquivos, além da migração e geração Prisma, com trabalho em AI, API, database e UI. Reservar uma etapa própria; erro parcial e transição histórica podem ampliar o esforço. Nullable, detalhamento por modelo, migração, budgets e UI não foram implementados. Apenas a correção independente de registro de uso do resumo (D-024) já está no código e deve ser preservada.

Não há transação entre a chamada externa e o banco. Mesmo com registro por resposta, queda do processo ou falha de persistência após consumo externo deixa uma janela sem comprovação local; registrar o limite e preparar reconciliação futura, sem prometer consumo exatamente uma vez. Uso interno do provider que não é exposto na resposta também não pode ser inventado. Homologação real e reconciliação com faturamento externo permanecem tarefas separadas.
