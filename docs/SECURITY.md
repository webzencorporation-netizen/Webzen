# Segurança e privacidade: controles técnicos

Este guia descreve controles implementados e seus limites no MVP em 2026-09-27. Não representa certificação, avaliação jurídica ou declaração de conformidade com a LGPD. A fonte é o código; decisões históricas estão em [DECISIONS.md](../DECISIONS.md).

## Autenticação, sessão e CSRF

Senhas usam Argon2id, com custo de memória 19.456 KiB, duas iterações e paralelismo 1; a política mínima é dez caracteres ([password.ts](../packages/database/src/password.ts)). O login normaliza o e-mail, usa resposta genérica para credenciais inválidas e verifica um hash fictício quando o usuário não existe.

O cookie `sid` contém token aleatório de 32 bytes; o banco guarda apenas seu SHA-256. É `httpOnly`, `SameSite=Lax`, `Path=/`; `Secure` é padrão em produção, mas pode ser sobrescrito por `COOKIE_SECURE`. Em produção, mantenha-o habilitado e sirva o painel via HTTPS. O TTL padrão é 14 dias; atualizar `lastSeenAt` não prolonga `expiresAt`. Logout remove a sessão. Troca de senha valida a senha atual e encerra as demais sessões, preservando a corrente. Veja [rotas](../apps/api/src/modules/auth/routes.ts) e [sessões](../apps/api/src/modules/auth/sessions.ts).

[CSRF](../apps/api/src/plugins/csrf.ts) exige presença de `X-Requested-With` em POST/PUT/PATCH/DELETE sob `/api/`, inclusive login. Quando `Origin` está presente, precisa corresponder à origem de `APP_URL` ou `API_PUBLIC_URL`; ausência de `Origin` é aceita. Não há token CSRF independente nem CORS habilitado. O painel envia o header pelo [cliente HTTP](../apps/web/src/lib/api.ts) e usa rewrite na mesma origem. O webhook tem autenticação própria por assinatura.

`mustChangePassword` é imposto pelo [hook de autenticação](../apps/api/src/plugins/auth.ts) nas rotas registradas `/api/*`. Uma sessão provisória recebe 403 com `details.reason=PASSWORD_CHANGE_REQUIRED`, exceto nos métodos explícitos de login, perfil próprio, troca de senha e logout. Troca de empresa, suporte e callback OAuth não contornam a restrição. O estado do usuário é relido em cada request; a regra também alcança sessões já abertas. O painel mantém o modal e recarrega os dados protegidos após a troca, inclusive para contas sem empresa. Não há MFA implementado.

## Autorização e suporte

[RBAC](../packages/shared/src/permissions.ts) é por permissão, verificada no servidor. `VIEWER`, `ATTENDANT`, `MANAGER`, `COMPANY_ADMIN` e `COMPANY_OWNER` têm conjuntos progressivos; `COMPANY_ADMIN` possui todas as permissões empresariais exceto `privacy:manage`. Papéis de plataforma são separados; somente `PLATFORM_OWNER` gerencia administradores da plataforma.

O escopo empresarial é derivado da sessão e associação ativa, conforme [MULTITENANCY.md](MULTITENANCY.md). A extensão Prisma não substitui a autorização, RLS nem a validação de IDs relacionados.

`POST /api/platform/companies/:id/support` exige `platform:support_mode` e motivo de 5–300 caracteres. O [serviço](../apps/api/src/modules/platform/companies.service.ts) concede uma hora de suporte, registra motivo/prazo/IP no início e usa papel efetivo `COMPANY_ADMIN`, sem associação comum. `DELETE /api/platform/support` encerra e audita a saída explícita. O guard verifica expiração a cada request; expirar não gera automaticamente o mesmo evento de saída. A auditoria empresarial adiciona `supportMode: true` às ações que chamam [audit](../apps/api/src/lib/audit.ts); não há registro automático de toda leitura ou request.

As permissões efetivamente exigidas por cada rota prevalecem: exclusão de contatos/conversas usa `contacts:delete`/`conversations:delete`, e a política de retenção usa `company:update`. Portanto essas operações também estão disponíveis ao administrador empresarial, apesar da reserva do nome `privacy:manage` ao proprietário.

## Segredos, criptografia e logs

[SecretBox](../apps/api/src/lib/crypto.ts) criptografa tokens de WhatsApp e credenciais Google com AES-256-GCM, IV aleatório de 12 bytes e tag de autenticação. `ENCRYPTION_KEY` deve representar 32 bytes em base64. É obrigatória em produção e para salvar credenciais; não há chave padrão. O formato é `v1.<iv>.<authTag>.<ciphertext>`, sem identificador de chave ou rotação automática.

Guarde a chave fora do repositório, restrinja acesso e preserve uma cópia recuperável separada do backup do banco. Trocar apenas a variável torna os ciphertexts existentes ilegíveis; uma rotação exige migração/recriptografia planejada. API e worker precisam usar a mesma chave. Credenciais de providers vêm do ambiente ou do banco criptografado e não devem ir a `NEXT_PUBLIC_*`, fixtures, prints ou tickets.

A criptografia acima cobre segredos de integrações, não todo o conteúdo do banco: mensagens, contatos, documentos, resumos, memórias e payloads de webhook permanecem dados legíveis para quem tiver acesso ao armazenamento. Criptografia de discos, backups e transporte dos serviços é responsabilidade do ambiente de implantação.

O [logger Pino](../apps/api/src/lib/logger.ts) redige caminhos conhecidos de senhas, cookies, tokens e credenciais. Isso não é sanitização universal: texto livre de erros, URLs, campos não listados e metadados em banco podem conter dados sensíveis. [ErrorLog](../apps/api/src/lib/error-log.ts) limita tamanho, mas não redige conteúdo; [AuditLog](../apps/api/src/lib/audit.ts) depende de metadados seguros fornecidos pelo chamador. Ao investigar falhas, compartilhe IDs, código, horário e estado; remova tokens e conteúdo pessoal antes de exportar logs.

## HTTP, webhooks, uploads e integrações

A [API](../apps/api/src/app.ts) usa Helmet, validação Zod, limite JSON de 2 MiB e rate limit padrão de 300/minuto; login usa 10/minuto e webhook 3.000/minuto. O Redis compartilha contadores entre instâncias reais. Health é isento. `trustProxy: true` exige que o ingresso confiável controle headers encaminhados e que a API não fique exposta diretamente a clientes capazes de falsificá-los.

A CSP está desabilitada no Helmet. O [Next](../apps/web/next.config.ts) adiciona `X-Frame-Options: DENY`, `nosniff`, política de referência e restrição de câmera/microfone/geolocalização; não configura CSP própria.

O [webhook](../apps/api/src/modules/webhooks/routes.ts) valida HMAC-SHA256 sobre os bytes originais e usa comparação de tempo constante. O verify token do GET serve à inscrição; o App Secret autentica POST. Não remova assinatura para contornar erro de proxy. OAuth Google usa state assinado com validade de dez minutos, vincula empresa/usuário e exige sessão correspondente, associação ativa e `integrations:manage` no [callback](../apps/api/src/modules/oauth/routes.ts). Como o cookie é restrito ao host que o emitiu, configure o retorno em `APP_URL/api/integrations/google/callback`, passando pelo rewrite do painel; um subdomínio diferente da API não recebe automaticamente essa sessão.

Multipart aceita um arquivo, até dez campos e `UPLOAD_MAX_BYTES` (16 MiB por padrão). A mídia é entregue pela API após escopo e visibilidade da conversa, em [getMediaForDownload](../apps/api/src/modules/company/conversations/service.ts); storage local verifica que a chave permaneça sob o diretório configurado. Manter bucket privado e não publicar diretórios locais é requisito operacional. Limites de tamanho e MIME não equivalem a antivírus.

[Validação do ambiente](../packages/config/src/env.ts) recusa mocks de IA, WhatsApp e STT em produção, sem flag de exceção, divergindo de D-008. Também recusa storage local em produção. Esses checks não comprovam a validade das credenciais nem a disponibilidade externa.

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

Use [VALIDATION.md](VALIDATION.md) para executar checks em infraestrutura exclusiva. As suítes [auth](../apps/api/test/auth.test.ts), [RBAC](../apps/api/test/rbac.test.ts), [plataforma](../apps/api/test/platform.test.ts), [webhook](../apps/api/test/webhook.test.ts) e [isolamento](../apps/api/test/tenant-isolation.test.ts) fornecem evidência dos cenários cobertos, sem substituir revisão de novos endpoints nem homologação externa.

Em suspeita de acesso indevido, preserve IDs/horários e auditoria, revogue as sessões e credenciais afetadas, revise associação e modo suporte, e verifique filas, banco e storage. Recuperação de backup e remoção de cópias externas precisam de procedimentos próprios; não há garantia de expurgo global fornecida pelo MVP.
