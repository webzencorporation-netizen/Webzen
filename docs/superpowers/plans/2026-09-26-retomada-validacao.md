# Retomada e validação da plataforma

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** concluir a validação da API, worker e painel já existentes, pendência da Fase 1 registrada no acompanhamento.

**Architecture:** preservar o monólito modular, o isolamento por companyId e os providers definidos em DECISIONS.md. Trabalhar sobre as alterações locais recebidas, sem refazer os módulos nem limpar a árvore Git.

**Tech Stack:** pnpm, Fastify, Prisma/PostgreSQL, BullMQ/Redis, Next.js, Vitest e Playwright nas versões já instaladas.

**Spec:** PROGRESS.md, DECISIONS.md, docs/TECHNICAL_PLAN.md e pedido de retomada de 2026-09-26.

## Restrições

- Uma plataforma, várias empresas; companyId derivado da sessão ou integração autenticada.
- Meta oficial e Claude; testes locais com mocks, sem chamadas pagas.
- Não alterar bancos de desenvolvimento/produção para executar testes.
- Preservar todos os arquivos e alterações recebidos.

## Foco da revisão

- Checkout novo deve conter os providers de armazenamento, hoje ocultos pelo gitignore.
- Lint não deve processar saídas de build; testes Vitest não devem coletar Playwright.
- Setup E2E deve compilar e atingir somente recursos de testes.
- Resposta na inbox deve atravessar API, fila real e worker.
- Documentação deve distinguir implementação existente de validação efetivamente executada.

## Tarefas

### 1. Diagnóstico e correção dos comandos de qualidade

**Arquivos:** .gitignore, eslint.config.mjs, packages/{config,shared,integrations}/package.json, apps/web/vitest.config.ts, apps/web/e2e/global-setup.ts.

- [x] Ler acompanhamento, decisões, README, docs, estrutura e diff antes de alterar arquivos.
- [x] Reproduzir falhas de lint, typecheck e pnpm test.
- [x] Corrigir seleção de arquivos e tipagem, preservando as regras do código de produção.
- [x] Executar lint, typecheck e testes; registrar os resultados em PROGRESS.md.

### 2. Concluir validação integrada e entrega operacional

**Arquivos:** configuração e cenários existentes em apps/web/e2e; apps/api/scripts/build.ts; documentação na raiz e docs.

- [x] Executar os testes da API com PostgreSQL de testes.
- [x] Executar Playwright com API, worker e painel isolados; corrigir falhas reproduzidas.
- [x] Executar build da API/worker e painel e verificar os entrypoints gerados.
- [x] Atualizar estado real, limitações, próximos passos e decisões necessárias.
- [x] Revisar o diff final sem sobrescrever trabalho anterior.

O pedido autoriza execução nesta sessão. Commits e publicação não fazem parte desta retomada.

## Registro da execução

- Etapa 1 concluída: lint/typecheck sem erros; 107 testes aprovados (61 unitários, 46 integração). Regra `storage/` ocultava quatro fontes existentes, agora visíveis ao Git.
- Decisão: continuar no diretório atual, pois o pedido exige assumir o estado exato e há trabalho local não commitado; um worktree vazio dessas alterações perderia o contexto necessário.
- Decisão: permitir zero testes nos pacotes sem suíte própria, de forma explícita, conforme o padrão já existente no web. Não contar essa saída como cobertura; ampliação da cobertura permanece no acompanhamento.
- Diagnóstico E2E: alerta de login selecionava também o anunciador do Next; mobile era executado indevidamente em desktop. Corrigidos e verificados: 7 cenários passaram.
- Diagnóstico teardown: grupos de processos inspecionados provaram que pnpm 12 separava os servidores do grupo gerenciado pelo Playwright. Comandos Node diretos e SIGTERM resolveram o encerramento; serviços anteriores preservados.
- Diagnóstico build: compile passava, mas `node dist/main.js` falhava em `@prisma/client`. `pnpm test:build` reproduziu a falha antes da correção; dependências runtime explícitas no manifesto da API fizeram ambos os entrypoints passar. API compilada respondeu readiness 200; worker compilado iniciou, ambos encerrados após a verificação.
- Revisão independente (`requesting-code-review`): nenhuma regressão importante identificada nas correções; fragilidade preexistente de credenciais E2E herdadas do shell encaminhada para reprodução e correção.
- Correção da revisão: o cenário de criação de empresa falhou com variáveis `SEED_ADMIN_*` divergentes antes da correção. Após fixar as credenciais em fixtures compartilhadas, os 7 cenários passaram com as mesmas variáveis divergentes.
- Decisão: não iniciar os próximos guias de domínio nem a homologação externa nesta etapa; a pendência original de API/worker/painel/integração foi concluída. Guias ausentes, cobertura incompleta e avisos das dependências estão explícitos em PROGRESS.md para a continuidade.
