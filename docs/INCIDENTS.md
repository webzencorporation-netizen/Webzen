# Diagnóstico e recuperação operacional

Este roteiro usa os controles existentes. Não há replay administrativo, reconciliador global de filas nem garantia de envio externo exatamente uma vez. Faça a investigação na empresa correta e preserve os identificadores antes de qualquer intervenção.

## Evidência inicial

Registre horário com fuso, `companyId`, `conversationId`, `Message.id`, `WebhookEvent.id` e `jobId` quando disponíveis. Use `/platform/errors` para erros finais e os logs estruturados da API/worker para tentativas anteriores. Evite copiar texto de clientes, payloads, cookies, tokens ou URLs que contenham credenciais.

Comece com `GET /health/ready`: ele testa PostgreSQL e Redis, mas não o worker ou providers externos. `/platform/admin` exibe o último heartbeat do worker; sinal com mais de 60 segundos aparece indisponível. O heartbeat é compartilhado e não identifica a saúde de cada réplica/fila. Um worker ativo não prova que todos os tipos de job estejam avançando.

A página de saúde faz put/get de `healthcheck/probe.txt` no storage. O indicador de IA usa execuções da última hora, WhatsApp usa estado local dos números e Google apenas configuração OAuth. Nenhum desses indicadores substitui homologação do provider.

## Entrada recebida sem resposta

1. Confira empresa, número, configuração da IA, modo/status da conversa, opt-out, horário e limites. Um agente pausado, atendimento humano ou fallback podem explicar o comportamento.
2. Localize o webhook pelo evento externo. `RECEIVED`/`PROCESSING` podem recuperar o job na reentrega com o mesmo ID; `FAILED` precisa ser confrontado com o estado/tentativas do BullMQ.
3. Confira se a mensagem existe, `agentHandledAt`, mídia pendente e eventos de domínio. A entrada atual grava esses efeitos numa transação; dados parciais criados antes da correção não recebem backfill automático.
4. Verifique buffer e processamento de mídia antes de reenfileirar. Mídia finalizada pode recuperar o agendamento sem repetir download/transcrição.
5. Se o job esgotou tentativas, preserve o erro e determine uma intervenção específica. Adicionar novamente o mesmo ID não reabre automaticamente um job falho retido.

As políticas atuais estão em [queues/types.ts](../apps/api/src/queues/types.ts): webhook tem cinco tentativas, agente três, envio/mídia quatro e dispatch de eventos cinco. Não altere status no banco nem apague jobs como tentativa genérica de recuperação.

## Envio incerto ou atrasado

Confira `Message.externalId`, `sentAt`, status e erro antes de repetir qualquer envio. Se o aceite externo já está persistido, o worker só completa consumo/outbox e não envia novamente, mesmo que o status tenha avançado para `DELIVERED`/`READ`.

Se a chamada externa aceitou a mensagem mas a gravação do ID falhou, o resultado é incerto. Reconciliar com os registros do provider e o destinatário de homologação é necessário antes de uma repetição controlada; o banco sozinho não prova que nada foi enviado.

`send_blocked` representa uma recusa local, por exemplo opt-out ou janela de atendimento fechada. A janela é verificada novamente no worker; texto que era permitido no enqueue pode deixar de ser permitido. Fora da janela, use somente um template aprovado e mantenha o consentimento. Não converta mensagens falhas em `QUEUED` por edição direta para contornar a regra.

## Perda de lease do agente

Falha Redis, timeout, expiração ou perda do token invalidam a lease. Confira saúde/conexões do Redis e pausas longas do processo; os comandos dedicados têm timeout máximo de dois segundos, sem fila offline/reconexão. O job pode repetir conforme a política limitada da fila.

O trabalho já realizado permanece contabilizado quando retornado pelo engine; resposta/fallback e novas tools são bloqueados após perda detectada. Requests/tools já em voo não são desfeitos. Antes de repetir uma operação que cria agenda, lead ou outro efeito, confira o registro de domínio e as tools executadas. Reiniciar o worker não fornece rollback.

## Exclusão ou retenção falhou

Falha no storage preserva as referências de contato/conversa/documento ou mídia, permitindo repetir a mesma exclusão após corrigir conectividade/permissões. Parte dos objetos pode já ter sido removida; deletes dos providers adotados são idempotentes. Não apague as referências restantes para silenciar o erro.

A retenção continua outras empresas e a limpeza técnica; falhas ficam no log com `companyId` e o job termina com erro agregado. O próximo agendamento diário pode repetir. A agenda atual usa `0 30 3 * * *` sem timezone explícito; confira o ambiente do scheduler em vez de presumir horário local.

Isso não reconcilia órfãos anteriores, uploads concorrentes, backups ou cópias nos providers. Memórias, resumos e previews não são removidos automaticamente pela retenção de mensagens. Consulte [SECURITY.md](SECURITY.md) antes de afirmar conclusão de um expurgo.

## Retomar atendimento

Suspender/cancelar a empresa bloqueia novos turnos/resumos automáticos e novos envios; o worker registra `send_blocked` para mensagens pendentes. Recebimentos/status e reparação de aceite persistido continuam. Não é parada global: mídia/STT, calendário, conhecimento e manutenção seguem seus fluxos, e trabalho externo já em voo pode concluir.

Reativar a empresa preserva a pausa manual da IA, não reproduz entradas antigas automaticamente e não reabre mensagens `FAILED`. Confira o backlog antes de provocar uma nova entrada ou ação controlada; não prometa que a reativação resolverá todo trabalho pendente.

Após corrigir a causa, valide uma conversa controlada, acompanhe o job e confirme o resultado na inbox e nos registros de uso. Reative somente o controle que foi pausado. Mantenha as credenciais e a empresa originais; criar outro cadastro, trocar provider para mock em produção ou apagar filas não resolve a causa.

Antes de aplicar uma release de correção, execute [VALIDATION.md](VALIDATION.md). Para infraestrutura, configuração e supervisão, consulte [DEPLOYMENT.md](DEPLOYMENT.md).
