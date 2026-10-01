# Cobrança (Stripe)

Como o WebZen cobra as assinaturas e o que precisa ser configurado na Stripe. Decisões em [D-035](../DECISIONS.md) (planos) e [D-039](../DECISIONS.md) (cobrança).

## Como funciona

```
Cliente escolhe plano e período (painel ou página de preços)
  → POST /api/app/billing/checkout {planKey, interval}       (só o proprietário)
      servidor busca o Price ID do plano, confere valor/moeda/período NA STRIPE,
      cria/reaproveita o cliente e abre o Checkout
  → cliente paga na Stripe
  → Stripe → POST /webhooks/stripe  (assinatura verificada sobre o corpo bruto)
      grava BillingEvent (único por ID do evento) e enfileira billing.event
  → worker relê a assinatura/fatura NA STRIPE e atualiza Subscription/Invoice
      notifica no painel e por e-mail (pagamento aprovado/recusado, cancelamento)
```

- O navegador nunca define preço: só envia plano e período. Se o preço cadastrado na Stripe divergir do plano (valor, moeda BRL, período ou inativo), o checkout é recusado e o erro vai para o log.
- O webhook não confia no conteúdo do evento nem na ordem de chegada: o job busca o objeto atual na Stripe. O banco guarda só ID, tipo e objeto do evento — nenhum dado pessoal do payload.
- Eventos repetidos são ignorados pela unicidade `(provider, externalId)`. Eventos de outro modo (`livemode` diferente do modo da chave) ficam `IGNORED`, então teste e produção não se misturam.
- Troca de plano é imediata, com cobrança proporcional calculada pela Stripe. Downgrade é bloqueado se o uso atual (usuários, números, automações, armazenamento) não couber no plano novo.
- Cancelamento agenda o fim para o término do período (`cancel_at_period_end`) e pode ser desfeito até lá.
- Assinatura `UNPAID`, `INCOMPLETE`, `PAUSED`, `CANCELLED` ou teste vencido bloqueia a IA; `PAST_DUE` mantém o serviço enquanto a Stripe tenta cobrar de novo.
- A plataforma vê os eventos em `GET /api/platform/billing/events` e reprocessa os que falharam (`POST /api/platform/billing/events/:id/replay`).

## Configuração (faça primeiro no modo teste)

1. **Produtos e preços.** Na Stripe, crie um produto por plano (Starter, Pro, Business) com dois preços recorrentes em **BRL**: mensal (intervalo 1 mês) e anual (intervalo 1 ano). Os valores precisam ser exatamente os da tabela `Plan` (hoje: R$ 250/450/750 por mês e R$ 2.500/4.500/7.500 por ano).
2. **IDs no ambiente.** Copie cada `price_...` para `STRIPE_PRICE_<PLANO>_<MONTHLY|YEARLY>` e rode `pnpm db:seed -- --reference` (grava os IDs nos planos). Também dá para colar no painel da plataforma, em **Planos**.
3. **Chaves.** `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY` (`sk_test_...` fora de produção; `sk_live_...` só em produção) e `STRIPE_WEBHOOK_SECRET` do endpoint.
4. **Webhook.** Endpoint `https://<api>/webhooks/stripe` com os eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`. Em desenvolvimento: `stripe listen --forward-to localhost:4000/webhooks/stripe` (o comando mostra o `whsec_...` a usar).
5. **Portal do cliente.** Ative o Customer Portal (Configurações → Billing → Customer portal) permitindo atualizar forma de pagamento e ver faturas. Troca e cancelamento de plano são feitos pelo painel do WebZen, que aplica as regras de limite.
6. **Cupons.** Crie cupons e códigos promocionais na Stripe (ex.: `WEBZEN20`, percentual ou valor fixo, validade, limite de usos, produtos permitidos). O checkout aceita códigos promocionais.
7. **Teste grátis (opcional).** `BILLING_TRIAL_DAYS` > 0 inicia o teste na confirmação do e-mail, um por pessoa; ao contratar durante o teste, o restante do período é preservado no checkout.

## Ao mudar um preço

Crie um **novo** preço na Stripe (preços não são editáveis), atualize o valor no painel da plataforma e o ID correspondente. Assinaturas existentes continuam no preço antigo até uma troca de plano; o checkout recusa qualquer combinação em que valor e ID não batam.

## Pendências conhecidas

- Moeda única (BRL). A estrutura (`currency` em plano e fatura, centavos inteiros) permite outras moedas, mas não há tabela de preços por moeda.
- Não há emissão de nota fiscal: a fatura é a da Stripe (`hostedUrl`/`pdfUrl`).
- Homologação com conta Stripe real pendente (credenciais não configuradas neste ambiente).
