# Segurança e privacidade: controles técnicos

Este guia descreve controles implementados e seus limites, revisados na auditoria de segurança de 2026-09-30 (D-034). Não representa certificação, avaliação jurídica ou declaração de conformidade com a LGPD. A fonte é o código; decisões históricas estão em [DECISIONS.md](../DECISIONS.md).

## Modelo de ameaças e princípios

Ativos principais: conversas e dados de contato dos clientes finais, agendamentos, dados comerciais de cada empresa, sessões, tokens do WhatsApp/Google (cifrados), chaves de IA e storage no ambiente, e o acesso administrativo da plataforma. Atores considerados: visitante anônimo, usuário autenticado malicioso, empresa tentando ler outra, bot automatizado, webhook forjado, prompt injection vindo do cliente final, credencial vazada e operador interno.

Princípios aplicados no código: **o backend sempre autoriza** (nada depende do frontend, do modelo de IA ou do cliente); **a IA propõe, o backend decide**; **falha fechada** (sem sessão/associação/permissão válida, nega); **empresa vem da sessão**, nunca do payload; segredos só no ambiente ou cifrados no banco.

## Autenticação, sessão e CSRF

Senhas usam Argon2id, com custo de memória 19.456 KiB, duas iterações e paralelismo 1; a política mínima é dez caracteres ([password.ts](../packages/database/src/password.ts)). O login normaliza o e-mail (espaços e maiúsculas) antes de validar, usa resposta genérica para credenciais inválidas e verifica um hash fictício quando o usuário não existe. Além do limite por IP, há limite **por conta** (`LOGIN_ACCOUNT_MAX_ATTEMPTS`, padrão 10 tentativas a cada 15 minutos, de qualquer IP), que conta toda tentativa — existente ou não, com a mesma resposta — para não revelar cadastros. Tentativas bloqueadas e falhas de login geram log de segurança (`security: login_account_limited | login_failed`), sem e-mail nem senha.

O cookie `sid` contém token aleatório de 32 bytes; o banco guarda apenas seu SHA-256. É `httpOnly`, `SameSite=Lax`, `Path=/`; `Secure` é padrão em produção, mas pode ser sobrescrito por `COOKIE_SECURE`. Em produção, mantenha-o habilitado e sirva o painel via HTTPS. O TTL padrão é 14 dias; atualizar `lastSeenAt` não prolonga `expiresAt`. Logout remove a sessão. Um novo login descarta a sessão que o navegador já tinha (proteção contra fixação de sessão) e sempre emite token novo. Troca de senha valida a senha atual e encerra as demais sessões, preservando a corrente. Veja [rotas](../apps/api/src/modules/auth/routes.ts) e [sessões](../apps/api/src/modules/auth/sessions.ts).

Sessões paradas por mais de `SESSION_IDLE_TIMEOUT_HOURS` (padrão 72 h) expiram mesmo antes do TTL. Em **Segurança** (`GET/DELETE /api/auth/sessions`, `POST /api/auth/sessions/revoke-others`) o usuário vê as próprias sessões (navegador/sistema derivados do User-Agent, IP e último acesso) e encerra as outras; o filtro por `userId` impede encerrar sessão de outra pessoa.

### Cadastro, confirmação de e-mail, recuperação de senha e convites (D-037)

- **Cadastro público** (`POST /api/auth/signup`, desligável com `SIGNUP_ENABLED=false`): cria pessoa, empresa e assinatura `INCOMPLETE`. A resposta é **idêntica** para e-mail novo ou já cadastrado (202, sem sessão) e o caminho do e-mail existente gasta o mesmo hash Argon2, para o tempo de resposta não denunciar cadastros; o dono do endereço recebe um aviso com link para entrar ou redefinir a senha. O plano vem de uma chave validada contra os planos ativos e públicos — nunca preço do navegador.
- **Login exige e-mail confirmado** (403 com `details.reason=EMAIL_NOT_VERIFIED`, só depois da senha correta). Contas criadas pela plataforma, pelo dono da empresa ou por convite já nascem confirmadas; a migração confirmou as contas existentes.
- **Tokens de e-mail** ([tokens.ts](../apps/api/src/modules/auth/tokens.ts)): 32 bytes aleatórios, só o SHA-256 no banco, uso único com marcação atômica, prazo (confirmação 48 h, redefinição 60 min), emissão nova invalida as anteriores e o token deixa de valer se o e-mail do usuário mudar. Redefinir a senha confirma o e-mail e encerra **todas** as sessões; um e-mail avisa a troca.
- **Convites** (`/api/app/team/invitations`): token de uso único com hash, 7 dias, revogável e reenviável (token novo). Empresa e papel saem do convite, nunca da requisição; quem já tem conta precisa estar logado nela para aceitar. Convites pendentes contam no limite de usuários do plano, verificado de novo no aceite.
- **Limites**: rotas que disparam e-mail têm limite por IP (`ACCOUNT_EMAIL_RATE_LIMIT_PER_HOUR`) e por endereço de destino (5/hora), contra uso do WebZen para encher a caixa de terceiros.
- **E-mails** saem por fila (`email.send`, 5 tentativas com backoff); o corpo (que pode conter link com token) é apagado da tabela depois do envio ou da falha final. Valores dinâmicos dos templates são escapados.

[CSRF](../apps/api/src/plugins/csrf.ts) exige presença de `X-Requested-With` em POST/PUT/PATCH/DELETE sob `/api/`, inclusive login. Quando `Origin` está presente, precisa corresponder à origem de `APP_URL` ou `API_PUBLIC_URL`; ausência de `Origin` é aceita. Não há token CSRF independente nem CORS habilitado. O painel envia o header pelo [cliente HTTP](../apps/web/src/lib/api.ts) e usa rewrite na mesma origem. O webhook tem autenticação própria por assinatura.

`mustChangePassword` é imposto pelo [hook de autenticação](../apps/api/src/plugins/auth.ts) nas rotas registradas `/api/*`. Uma sessão provisória recebe 403 com `details.reason=PASSWORD_CHANGE_REQUIRED`, exceto nos métodos explícitos de login, perfil próprio, troca de senha e logout. Troca de empresa, suporte e callback OAuth não contornam a restrição. O estado do usuário é relido em cada request; a regra também alcança sessões já abertas. O painel mantém o modal e recarrega os dados protegidos após a troca, inclusive para contas sem empresa. Não há MFA implementado (planejado para administradores da plataforma).

## Autorização e suporte

[RBAC](../packages/shared/src/permissions.ts) é por permissão, verificada no servidor. `VIEWER`, `ATTENDANT`, `MANAGER`, `COMPANY_ADMIN` e `COMPANY_OWNER` têm conjuntos progressivos; `COMPANY_ADMIN` possui todas as permissões empresariais exceto `privacy:manage`. Papéis de plataforma são separados; somente `PLATFORM_OWNER` gerencia administradores da plataforma.

O escopo empresarial é derivado da sessão e associação ativa, conforme [MULTITENANCY.md](MULTITENANCY.md). A extensão Prisma não substitui a autorização, RLS nem a validação de IDs relacionados.

`POST /api/platform/companies/:id/support` exige `platform:support_mode` e motivo de 5–300 caracteres. O [serviço](../apps/api/src/modules/platform/companies.service.ts) concede uma hora de suporte, registra motivo/prazo/IP no início e usa papel efetivo `COMPANY_ADMIN`, sem associação comum. `DELETE /api/platform/support` encerra e audita a saída explícita. O guard verifica expiração a cada request; expirar não gera automaticamente o mesmo evento de saída. A auditoria empresarial adiciona `supportMode: true` às ações que chamam [audit](../apps/api/src/lib/audit.ts); não há registro automático de toda leitura ou request.

As permissões efetivamente exigidas por cada rota prevalecem: exclusão de contatos/conversas usa `contacts:delete`/`conversations:delete`, e a política de retenção usa `company:update`. Portanto essas operações também estão disponíveis ao administrador empresarial, apesar da reserva do nome `privacy:manage` ao proprietário.

## Segredos, criptografia e logs

[SecretBox](../apps/api/src/lib/crypto.ts) criptografa tokens de WhatsApp e credenciais Google com AES-256-GCM, IV aleatório de 12 bytes e tag de autenticação. `ENCRYPTION_KEY` deve representar 32 bytes em base64. É obrigatória em produção e para salvar credenciais; não há chave padrão. O formato é `v1.<iv>.<authTag>.<ciphertext>`, sem identificador de chave ou rotação automática.

Guarde a chave fora do repositório, restrinja acesso e preserve uma cópia recuperável separada do backup do banco. Trocar apenas a variável torna os ciphertexts existentes ilegíveis; uma rotação exige migração/recriptografia planejada. API e worker precisam usar a mesma chave. Credenciais de providers vêm do ambiente ou do banco criptografado e não devem ir a `NEXT_PUBLIC_*`, fixtures, prints ou tickets.

A criptografia acima cobre segredos de integrações, não todo o conteúdo do banco: mensagens, contatos, documentos, resumos, memórias e payloads de webhook permanecem dados legíveis para quem tiver acesso ao armazenamento. Criptografia de discos, backups e transporte dos serviços é responsabilidade do ambiente de implantação.

O [logger Pino](../apps/api/src/lib/logger.ts) remove, em **qualquer profundidade** (até 8 níveis, inclusive dentro de erros), campos com nomes sensíveis: senhas, hashes, tokens, `authorization`, cookies, `x-api-key`, credenciais e nomes das variáveis de chave (`ANTHROPIC_API_KEY`, `META_MODEL_API_KEY`, `DATABASE_URL`...). O `redact` nativo do Pino só cobria um nível; a troca foi medida (≈3 → 5 µs por linha). Isso não é sanitização universal: texto livre de erros, URLs, campos não listados e metadados em banco podem conter dados sensíveis. [ErrorLog](../apps/api/src/lib/error-log.ts) limita tamanho, mas não redige conteúdo; [AuditLog](../apps/api/src/lib/audit.ts) depende de metadados seguros fornecidos pelo chamador. Ao investigar falhas, compartilhe IDs, código, horário e estado; remova tokens e conteúdo pessoal antes de exportar logs.

## HTTP, webhooks, uploads e integrações

A [API](../apps/api/src/app.ts) usa Helmet, validação Zod, limite JSON de 2 MiB e rate limit padrão de 300/minuto; login usa 10/minuto e webhook 3.000/minuto. O Redis compartilha contadores entre instâncias reais. Health é isento. O IP do cliente só é lido de `X-Forwarded-For` quando vem de um proxy configurado em `TRUST_PROXY` (saltos ou IPs/CIDRs); por padrão nenhum proxy é confiável e `TRUST_PROXY=true` é recusado, porque permitiria forjar o IP e burlar os limites por IP. Atrás de um balanceador, configure `TRUST_PROXY` com o número de saltos dele.

A CSP está desabilitada no Helmet da API (respostas JSON). O [painel](../apps/web/security-headers.ts) envia `X-Frame-Options: DENY`, `nosniff`, política de referência e restrição de câmera/microfone/geolocalização; **em produção** também CSP restrita à própria origem (`default-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`) e HSTS de um ano. `'unsafe-inline'` em scripts/estilos é exigido pelo Next sem nonce ([guia oficial "Without Nonces"](../apps/web/node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)); o painel não carrega recursos de terceiros. Verificado com build de produção no navegador: sem violações.

O [webhook](../apps/api/src/modules/webhooks/routes.ts) valida HMAC-SHA256 sobre os bytes originais e usa comparação de tempo constante. O verify token do GET serve à inscrição; o App Secret autentica POST. Não remova assinatura para contornar erro de proxy. OAuth Google usa state assinado com validade de dez minutos, vincula empresa/usuário e exige sessão correspondente, associação ativa e `integrations:manage` no [callback](../apps/api/src/modules/oauth/routes.ts). Como o cookie é restrito ao host que o emitiu, configure o retorno em `APP_URL/api/integrations/google/callback`, passando pelo rewrite do painel; um subdomínio diferente da API não recebe automaticamente essa sessão.

Multipart aceita um arquivo, até dez campos e `UPLOAD_MAX_BYTES` (16 MiB por padrão). A mídia é entregue pela API após escopo e visibilidade da conversa, em [getMediaForDownload](../apps/api/src/modules/company/conversations/service.ts); storage local verifica que a chave permaneça sob o diretório configurado. Manter bucket privado e não publicar diretórios locais é requisito operacional. Limites de tamanho e MIME não equivalem a antivírus.

[Validação do ambiente](../packages/config/src/env.ts) recusa mocks de IA, WhatsApp e STT em produção, sem flag de exceção, divergindo de D-008. Também recusa storage local em produção. Esses checks não comprovam a validade das credenciais nem a disponibilidade externa.

## API pública, chaves e webhooks (D-041)

Rotas `/api/v1` aceitam só `Authorization: Bearer wz_...` (o cookie de sessão é ignorado, por isso não há CSRF nelas). A chave é guardada como SHA-256; a cada requisição são conferidos revogação, ambiente da chave, situação da empresa, recurso `API_ACCESS` do plano e assinatura ativa. Limite de 120 req/min por chave e `Idempotency-Key` nos POST. Webhooks de saída são assinados com HMAC-SHA256 (segredo cifrado no banco) e enviados por [safe-http](../apps/api/src/lib/safe-http.ts): https obrigatório em produção, IP validado na conexão contra redes internas e metadados de nuvem, sem redirecionamentos e com timeout.

## Inventário de endpoints

Toda rota registra, via [route-inventory](../apps/api/src/plugins/route-inventory.ts), os guards que a protegem (`authenticated`, `company(permissão)`, `platform(permissão)`). O teste [security-surface](../apps/api/test/security-surface.test.ts) impõe a política sobre as ~155 rotas: só login, logout, callback OAuth (state assinado), health e webhook (HMAC) são públicas; toda rota `/api/app/*` exige empresa da sessão e toda escrita exige permissão específica (exceto marcar as próprias notificações como lidas); toda rota `/api/platform/*` exige papel de plataforma. O mesmo teste chama cada rota sem sessão (401), como dono de empresa nas rotas da plataforma (403) e como `VIEWER` em todas as escritas sem permissão (403). Uma rota nova sem guard quebra o CI.

## IA e ferramentas do agente

O modelo é tratado como componente não confiável. Ele só recebe as ferramentas **habilitadas** para a empresa; toda chamada passa por schema Zod, autorização da ferramenta e timeout (20 s) no [engine](../packages/ai/src/engine.ts), e erros voltam ao modelo como resultado estruturado, nunca como sucesso inventado. Empresa, contato e conversa vêm do contexto confiável do atendimento, nunca de argumentos do modelo: IDs informados pelo modelo (ex.: `appointmentId`) são resolvidos pelo client com escopo de empresa e conferidos contra o contato da conversa. Ações de agenda exigem `customerConfirmed: true`, que continua sendo informado pelo modelo — é uma barreira de fluxo, não de autenticação. Mensagens do cliente, documentos e trechos da base de conhecimento entram como dados, não como instruções; nenhuma credencial do ambiente vai ao prompt. O "Testar agente" usa a IA paga e por isso tem limite por empresa (`AI_TEST_RATE_LIMIT_PER_MINUTE`, padrão 20) e respeita os mesmos limites de plano e orçamento do atendimento. Evidência: [security-llm](../apps/api/test/security-llm.test.ts) e [engine](../packages/ai/test/engine.test.ts).

## Segredos no repositório e dependências

`.env` e `.env.*` são ignorados pelo git (exceto `.env.example`, sem valores). `pnpm check:secrets` procura padrões de chaves (Anthropic, Meta, WhatsApp, Neon, AWS, GitHub, OpenAI, chaves privadas, URLs de banco com senha) e arquivos `.env` versionados, informando só arquivo, linha e tipo — nunca o valor. Roda no CI a cada push e pode ser usado como hook de pré-commit local (`pnpm check:secrets --staged`). O CI também roda `pnpm audit --audit-level high`. Correções de dependências transitivas do CLI do Prisma ficam em `overrides` no `pnpm-workspace.yaml`. **Se uma credencial real for commitada, remover o arquivo não basta: ela deve ser rotacionada.**

## Exportação, exclusão e retenção

| Operação implementada                               | Escopo e limite                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/app/contacts/:id/export`                  | `contacts:export`; JSON com contato, etiquetas, notas, memórias, leads, agenda e campos selecionados das mensagens. Não é cópia integral de todos os objetos/mídias ou registros técnicos. |
| `GET /api/app/exports/contacts.csv`, `/crm.csv`     | `contacts:export`; até 50.000 registros por exportação, com neutralização de fórmulas de planilha.                                                                                         |
| `GET /api/app/exports/usage.csv`                    | `usage:read`; até 50.000 registros.                                                                                                                                                        |
| `DELETE /api/app/contacts/:id`                      | `contacts:delete`; remove arquivos conhecidos antes do contato/cascatas; falha no storage preserva referências para repetir.                                                               |
| `DELETE /api/app/conversations/:id`                 | `conversations:delete`; verifica visibilidade e remove arquivos conhecidos antes da conversa/cascatas.                                                                                     |
| `PATCH /api/app/company` com `messageRetentionDays` | `company:update`; aceita 30–3.650 dias ou `null`. `null` não aplica expiração automática de mensagens dessa empresa.                                                                       |

Fontes: [exportações CSV](../apps/api/src/modules/company/privacy/service.ts), [contatos](../apps/api/src/modules/company/contacts/service.ts), [conversas](../apps/api/src/modules/company/conversations/service.ts), [configuração](../apps/api/src/modules/company/settings/routes.ts) e [schema/cascatas](../packages/database/prisma/schema.prisma).

[runRetention](../apps/api/src/modules/maintenance/service.ts), agendado diariamente pelo worker, remove mensagens e mídias anteriores ao corte por `createdAt`, incluindo mídias recentes ligadas a mensagens que serão excluídas; também exclui sessões expiradas e eventos técnicos antigos: webhooks `PROCESSED`/`IGNORED` recebidos há mais de 30 dias e eventos de domínio processados há mais de 30 dias. Webhooks pendentes/falhos não entram nessa limpeza. Falha de uma empresa preserva suas referências, permite processar as demais e deixa o job com erro agregado; o próximo agendamento pode repetir.

Retenção de mensagens não remove automaticamente contatos, memórias, resumos, previews de conversas, auditoria, erros ou dados já enviados a providers. Exclusões de contato/conversa também não equivalem a expurgo de payloads independentes de webhook, logs, backups ou cópias externas. Falhas no storage agora interrompem a exclusão antes de apagar referências, inclusive em documentos de conhecimento. Objetos já removidos não são restaurados se uma etapa posterior falhar. Não há transação entre storage e banco, bloqueio de uploads concorrentes nem reconciliação automática de órfãos anteriores; D-022 registra esses limites.

## Verificação operacional

Use [VALIDATION.md](VALIDATION.md) para executar checks em infraestrutura exclusiva. As suítes [auth](../apps/api/test/auth.test.ts), [RBAC](../apps/api/test/rbac.test.ts), [plataforma](../apps/api/test/platform.test.ts), [webhook](../apps/api/test/webhook.test.ts), [isolamento](../apps/api/test/tenant-isolation.test.ts), [superfície](../apps/api/test/security-surface.test.ts), [abuso](../apps/api/test/security-abuse.test.ts), [IA](../apps/api/test/security-llm.test.ts), [logs](../apps/api/test/log-redaction.test.ts) e [segredos](../apps/api/test/check-secrets.test.ts) fornecem evidência dos cenários cobertos, sem substituir revisão de novos endpoints nem homologação externa.

Em suspeita de acesso indevido, preserve IDs/horários e auditoria, revogue as sessões e credenciais afetadas, revise associação e modo suporte, e verifique filas, banco e storage. Recuperação de backup e remoção de cópias externas precisam de procedimentos próprios; não há garantia de expurgo global fornecida pelo MVP.

## Reportar uma vulnerabilidade (interno)

Não abra issue pública nem cole detalhes em chats compartilhados. Avise o responsável técnico da WebZen diretamente, com: o que é afetado, como reproduzir em ambiente de desenvolvimento (nunca contra dados reais de clientes), impacto estimado e se alguma credencial pode ter vazado. Credencial suspeita é rotacionada primeiro e investigada depois. A correção entra com teste que reproduz a falha e registro em `DECISIONS.md`.

## Boas práticas para quem desenvolve

- Nunca commitar `.env`; segredos novos entram no `.env.example` só com o nome e um comentário.
- Rota nova: use `company(permissão)` ou `platform(permissão)` — o teste de superfície recusa rota sem guard ou escrita sem permissão.
- Nunca aceitar `companyId` do cliente; use o client com escopo da sessão. SQL cru (`$queryRaw`) não passa pela extensão de empresa: filtre `companyId` explicitamente e use parâmetros (`Prisma.sql`), nunca concatenação.
- Ferramenta nova da IA: schema Zod estrito, contexto (empresa/contato) vindo do atendimento, `mutating: true` para escrita e checagem de dono de qualquer ID recebido.
- Chamada externa nova: timeout explícito, sem URL vinda do usuário, erro classificado como repetível ou não.
- Não logar payloads inteiros de terceiros nem dados pessoais desnecessários.
