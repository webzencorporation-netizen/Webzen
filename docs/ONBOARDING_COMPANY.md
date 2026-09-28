# Cadastrar e ativar uma empresa

Uma nova empresa é configuração na plataforma existente: não se cria repositório, banco ou instância de código por cliente. O acesso aos dados depende da empresa ativa na sessão e das permissões do usuário.

## Provisionar

1. Entre como administrador da plataforma e abra `/platform` → **Nova empresa**.
2. Informe nome, segmento/template, fuso horário, contato, plano e responsável.
3. Salve. O serviço cria empresa em `ONBOARDING`, vínculo de proprietário, assinatura do plano e aplica template de negócio (agente, tools e dados padrão).
4. Se o e-mail do responsável for novo, guarde a senha temporária retornada e entregue-a por um canal apropriado. O painel exige a troca e a API bloqueia os demais acessos protegidos até ela ser concluída. Se o usuário já existe, o serviço cria o novo vínculo e mantém a senha existente, sem retornar uma nova senha.

O backend é [createCompany](../apps/api/src/modules/platform/companies.service.ts); não envie `companyId` arbitrário em rotas do painel. Quando um usuário pertence a mais de uma empresa, selecione explicitamente a empresa ativa antes de configurar.

Na implantação inicial é necessário já haver um `PLATFORM_OWNER`; veja o comando de bootstrap em [DEPLOYMENT.md](DEPLOYMENT.md). Os logins da Clínica Demo são exclusivos de desenvolvimento.

## Configurar o atendimento

O proprietário acessa `/app/onboarding`. As etapas são salvas no banco e também reconhecem dados já cadastrados:

| Etapa       | Conteúdo e verificação                                             |
| ----------- | ------------------------------------------------------------------ |
| Empresa     | Nome, telefone, descrição, contatos e endereço corretos            |
| Horários    | Expediente no fuso da empresa, pausas e feriados                   |
| Catálogo    | Serviços/produtos, duração, preços ou ausência de preço fixo       |
| FAQ         | Respostas oficiais, políticas e restrições na base de conhecimento |
| IA          | Nome, personalidade, tom, regras, tools e parâmetros do atendente  |
| WhatsApp    | Número registrado e validado pela API oficial                      |
| Integrações | Agenda interna já disponível; Google opcional                      |
| Teste       | Conversa de teste concluída com o agente                           |
| Ativação    | Revisão final e habilitação do atendimento                         |

O template é ponto de partida. Revise informações sugeridas; não trate exemplos de outro segmento como políticas reais da empresa. Confira também limites/features do plano em `/platform/companies/:id`: tools e telas podem depender deles.

O indicador de progresso aceita conclusão manual e etapas puladas. A ativação atual exige somente etapas de empresa e IA concluídas; não comprova que WhatsApp, conhecimento, agenda ou providers externos estejam homologados. A revisão operacional abaixo continua necessária.

## Validar antes de ativar

- Em `/app/agent/test`, pergunte sobre expediente, catálogo e FAQ; verifique tools e fontes recuperadas. O teste não envia WhatsApp e simula ações de domínio. Com provider Anthropic configurado, a geração de resposta usa IA real e pode consumir tokens.
- Teste informação inexistente: o atendente deve reconhecer o limite ou encaminhar, sem inventar dados.
- Teste pedido de pessoa: handoff deve interromper a IA e tornar a conversa disponível à equipe.
- Para negócios com agenda, confira fuso, duração, horário ocupado e confirmação explícita antes de criar/cancelar/remarcar.
- Confira equipe e papéis em `/app/team`; atendente e somente leitura não devem receber acesso administrativo indevido.
- Com WhatsApp mock, use **Integrações → Simulador de WhatsApp** para atravessar ingestão, fila, worker e inbox. IA e WhatsApp são providers independentes: mock de WhatsApp não implica IA simulada.

Para conexão real, siga [WHATSAPP.md](WHATSAPP.md). Tokens são informados em Integrações e armazenados criptografados; nunca os registre em arquivos versionados ou notas do contato. O número identifica a empresa no webhook e não deve ser compartilhado entre cadastros.

## Ativar e acompanhar

Em `/app/onboarding`, **Ativar atendimento** conclui o onboarding e habilita a IA. A transição automática de status é de `ONBOARDING` para `ACTIVE`; empresas suspensas/canceladas não são reativadas por esse botão. Uma conta da plataforma deve revisar o status quando necessário.

Após ativar, envie uma mensagem controlada pelo número de homologação, confirme a resposta na inbox e execute o ciclo **Assumir conversa → responder → Devolver para IA**. Confira métricas, custo estimado, histórico de tools e erros. Fora da janela de atendimento, use templates aprovados conforme a regra existente.

Em incidente, pause a IA na configuração/emergência e direcione conversas à equipe. Revise integrações, saúde do worker, jobs e limites antes de retomar. Não crie outra empresa para contornar erro de configuração ou cota.

## Suporte e critérios de aceite

O modo suporte da plataforma exige motivo e tem expiração/auditoria. Use-o para a empresa selecionada, encerrando-o ao finalizar. Evite compartilhar a senha do cliente.

A implantação da empresa está pronta para operação quando perfil/catálogo/FAQ foram aprovados por seu responsável, número real e templates foram homologados, a equipe consegue assumir conversas, o agente respeita as regras, os dados permanecem isolados e os custos/limites são acompanhados. O progresso visual do assistente, sozinho, não prova esses critérios.

Testes automatizados correspondentes: [company-panel.test.ts](../apps/api/test/company-panel.test.ts), [tenant-isolation.test.ts](../apps/api/test/tenant-isolation.test.ts), [agent-flow.test.ts](../apps/api/test/agent-flow.test.ts) e [critical-flows.spec.ts](../apps/web/e2e/critical-flows.spec.ts).
