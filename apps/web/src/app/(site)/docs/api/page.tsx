import { API_SCOPE_LABELS, API_SCOPES, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS } from '@botsaas/shared';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Documentação da API',
  description: 'API pública v1 e webhooks do WebZen: autenticação por chave, limites, idempotência e verificação de assinatura.',
  alternates: { canonical: '/docs/api' },
};

const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/contacts', scope: 'contacts:read', text: 'Lista contatos (paginação: page, pageSize; busca: search).' },
  { method: 'GET', path: '/api/v1/contacts/{id}', scope: 'contacts:read', text: 'Detalhe de um contato.' },
  { method: 'POST', path: '/api/v1/contacts', scope: 'contacts:write', text: 'Cria um contato (phone obrigatório; name, email, source opcionais).' },
  { method: 'GET', path: '/api/v1/conversations', scope: 'conversations:read', text: 'Lista conversas do WhatsApp.' },
  { method: 'GET', path: '/api/v1/conversations/{id}/messages', scope: 'conversations:read', text: 'Mensagens de uma conversa (before, limit até 100).' },
  { method: 'POST', path: '/api/v1/messages', scope: 'messages:send', text: 'Envia texto numa conversa (conversationId, text). Só dentro da janela de 24 h do WhatsApp.' },
];

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from 'node:crypto';

// header: X-WebZen-Signature: t=1759340000,v1=<hex>
export function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const [, t, v1] = header.match(/^t=(\\d+),v1=([a-f0-9]{64})$/) ?? [];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}`;

export default function ApiDocsPage() {
  return (
    <article className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">Documentação da API</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        API v1 e webhooks, disponíveis no plano Business. Especificação completa em{' '}
        <a href="/api/public/openapi.json" className="text-brand-700 underline">
          OpenAPI (JSON)
        </a>
        .
      </p>

      <div className="mt-12 space-y-12 leading-relaxed text-slate-700">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">Autenticação</h2>
          <p className="mt-3">
            Crie uma chave em <strong>Configurações → API e webhooks</strong> e envie em todas as requisições:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-ink p-4 text-sm text-white">
            <code>Authorization: Bearer wz_live_...</code>
          </pre>
          <p className="mt-3">Cada chave tem permissões. Uma chave revogada, ou de uma empresa cujo plano não inclui API, recebe 401/403.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {API_SCOPES.map((scope) => (
              <li key={scope} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-mono text-xs text-brand-700">{scope}</span>
                <span className="block">{API_SCOPE_LABELS[scope]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">Limites e retries</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>120 requisições por minuto por chave (429 quando excedido).</li>
            <li>
              Envie <code className="font-mono text-sm">Idempotency-Key</code> nos POST: repetir a mesma chave em até 24 h devolve a resposta original, sem criar de novo.
            </li>
            <li>Erros seguem o formato {'{ "error": { "code", "message", "requestId" } }'}.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">Endpoints</h2>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-left text-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Rota</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Permissão</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">O que faz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {ENDPOINTS.map((endpoint) => (
                  <tr key={`${endpoint.method} ${endpoint.path}`}>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <span className="font-semibold text-brand-700">{endpoint.method}</span> {endpoint.path}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{endpoint.scope}</td>
                    <td className="px-4 py-2.5">{endpoint.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">Webhooks</h2>
          <p className="mt-3">
            Cada evento é um POST JSON <code className="font-mono text-sm">{'{ id, type, createdAt, data }'}</code> com os cabeçalhos{' '}
            <code className="font-mono text-sm">X-WebZen-Event</code>, <code className="font-mono text-sm">X-WebZen-Delivery</code> e{' '}
            <code className="font-mono text-sm">X-WebZen-Signature</code>. Responda 2xx em até 10 s; falhas são repetidas com intervalo crescente por cerca de 10 minutos. O mesmo
            evento reenviado mantém o <code className="font-mono text-sm">id</code>: use-o para não processar duas vezes.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((event) => (
              <li key={event} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-mono text-xs text-brand-700">{event}</span>
                <span className="block">{WEBHOOK_EVENT_LABELS[event]}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-8 text-lg font-semibold text-foreground">Verificando a assinatura (Node.js)</h3>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-ink p-4 text-sm leading-relaxed text-white">
            <code>{VERIFY_SNIPPET}</code>
          </pre>
        </section>
      </div>
    </article>
  );
}
