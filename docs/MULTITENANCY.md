# Isolamento multiempresa

O MVP usa banco PostgreSQL e schema únicos. Dados empresariais carregam `companyId`; não há banco por cliente nem Row Level Security (RLS). A barreira principal é a aplicação: sessão validada, autorização e [extensão Prisma](../packages/database/src/tenant.ts). Este documento detalha D-004 de [DECISIONS.md](../DECISIONS.md).

## Origem da empresa ativa

No painel, [loadSession](../apps/api/src/modules/auth/sessions.ts) resolve o token opaco e rejeita sessões expiradas e usuários inativos. O guard [company(permission)](../apps/api/src/plugins/guards.ts) resolve `Session.activeCompanyId`, consulta `CompanyMember` a cada request, exige associação ativa e bloqueia empresas `SUSPENDED` ou `CANCELLED` no acesso normal. O papel atual determina as permissões.

Nos jobs de atendimento, esses estados também bloqueiam novos turnos/resumos de IA e envios, com revalidação depois do resultado do agente. Aceite externo já persistido continua reparando efeitos locais. Isso é independente de `AIConfiguration.enabled`; reativar empresa não remove pausa manual nem reproduz backlog automaticamente. Recebimentos, status e demais categorias de job continuam; D-023 detalha os limites.

`POST /api/auth/switch-company` é a exceção explícita em que o cliente informa um `companyId`: a [rota](../apps/api/src/modules/auth/routes.ts) valida associação e estado antes de salvar a seleção na sessão e limpar modo suporte. Isso não permite escolher livremente o escopo das rotas `/api/app/*`. Nelas, campos extras como `companyId` não substituem o escopo confiável.

Modo suporte exige permissão de plataforma e prazo válido; usa `supportCompanyId`, ator `PLATFORM_ADMIN` e papel efetivo `COMPANY_ADMIN`. É uma via administrativa deliberada, sem exigir associação comum e sem aplicar o bloqueio de status do acesso normal. Início/fim e ações auditadas são descritos em [SECURITY.md](SECURITY.md).

Em webhooks, a empresa é resolvida pelo número cadastrado no banco, após validação de assinatura. Jobs usam IDs persistidos/enfileirados pela aplicação. [systemScope](../apps/api/src/lib/scope.ts) cria o escopo interno com permissões de proprietário; ele não autentica o chamador nem valida a procedência do `companyId`. Só deve receber identidade já resolvida por código confiável.

## O que a extensão Prisma protege

`createTenantClient(companyId)` rejeita escopo vazio e intercepta operações de modelos presentes em `TENANT_SCOPED_MODELS`:

- Leituras, contagens, agregações, updates e deletes recebem `companyId` no `where` externo.
- Creates e createMany recebem `companyId` em cada objeto de dados.
- Upsert combina filtro de empresa, validação da criação e proteção contra mudança de empresa.
- `companyId` explícito divergente e escrita direta da relação `company` são rejeitados; operações/modelos não suportados também são rejeitados.

Por exemplo, `scope.db.contact.findUnique({ where: { id } })` só encontra o contato se pertencer ao escopo. Um UUID conhecido de outra empresa não concede acesso.

`Company`, `User`, `Session`, `Plan` e `ModelPricing` são globais e não são acessíveis como modelos pelo client empresarial. Para o próprio registro `Company`, use [getOwnCompany/updateOwnCompany](../apps/api/src/lib/company-record.ts), que fixam `id: scope.companyId`. Alguns modelos operacionais, como `AuditLog`, permitem `companyId` nulo para registros da plataforma; o client de tenant continua restringindo a uma empresa concreta.

## O que ela não protege

**A extensão não é RLS nem um validador recursivo de relacionamentos.** `$queryRaw`/`$executeRaw` não passam pelo filtro de modelos. Nested writes (`connect`, `create`, `update` dentro de relações) e resultados de `include` não recebem uma validação recursiva desta implementação. Relações por ID no [schema](../packages/database/prisma/schema.prisma) não equivalem a uma FK composta que garanta a mesma empresa dos dois lados.

Antes de gravar `contactId`, `serviceId`, `stageId`, `tagId`, `conversationId` ou similar, consulte o registro pelo mesmo `scope.db` e rejeite a ausência. Para `assigneeId`, que referencia um `User` global, valide `CompanyMember` ativo naquela empresa. O [CRM](../apps/api/src/modules/company/crm/service.ts) demonstra validação de contato, etapa e responsável; [setContactTags](../apps/api/src/modules/company/contacts/service.ts) valida todas as etiquetas. Sem essa etapa, um registro com `companyId` correto pode apontar para dados de outra empresa, inclusive expondo-os por uma relação carregada depois.

SQL cru deve usar parâmetros e filtro `companyId` explícito em cada caminho. A [busca de conhecimento](../apps/api/src/modules/knowledge/retriever.ts) faz isso tanto no full-text quanto no fallback. Não execute SQL interpolando valores do usuário como texto.

O [client global](../packages/database/src/client.ts), exportado como `systemDb`, ignora o escopo. Seu uso é reservado a auth, plataforma, descoberta da empresa em webhooks, jobs e helpers internos específicos. A [regra ESLint](../eslint.config.mjs) bloqueia o import nomeado de `systemDb` nos módulos `apps/api/src/modules/company/**/*.ts`; é uma proteção estática limitada, não uma sandbox contra outros imports, SQL cru ou helpers inseguros.

## Checklist para novos fluxos

1. Acrescente `companyId`, relação e índices apropriados ao modelo; atualize `TENANT_SCOPED_MODELS` e a migração.
2. Na rota, exija `company('permissão')`; derive o contexto com `scopeFromRequest` e passe `CompanyScope` ao serviço.
3. Use `scope.db` e valide todos os IDs de relacionamentos antes da escrita. Não permita transferência de dados entre empresas por update de `companyId`.
4. Em jobs, releia os registros pelo escopo, aceite que já possam ter sido excluídos e planeje reexecução. Não exponha enqueue arbitrário a clientes.
5. Em consultas globais necessárias, documente a origem confiável do escopo e cada filtro. Mantenha dados de suporte identificados na auditoria.
6. Acrescente cenários com empresas A/B: leitura, alteração, exclusão, exportação, relacionamento estrangeiro e troca de empresa. Inclua revogação de associação e restrições de papel.

## Evidência e limite da cobertura

[tenant-scope.test.ts](../packages/database/test/tenant-scope.test.ts) testa transformações da extensão; [schema-consistency.test.ts](../packages/database/test/schema-consistency.test.ts) compara modelos com `companyId` à lista protegida. [tenant-isolation.test.ts](../apps/api/test/tenant-isolation.test.ts) exercita contatos entre empresas, payload de empresa falsa, troca de empresa e perda de associação. Essas suítes não provam isolamento de toda combinação de nested writes/SQL cru; revisar cada novo caminho continua necessário. Veja [VALIDATION.md](VALIDATION.md) antes de executar integração em banco exclusivo.

RLS permanece alternativa futura. Adotá-la exigiria definir políticas, papel de banco, propagação do tenant por transação/conexão no pool e testes de bypass administrativo; nenhum desses controles está ativo hoje.
