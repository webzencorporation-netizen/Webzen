import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/legal-page';

export const metadata: Metadata = { title: 'Política de cookies', alternates: { canonical: '/cookies' } };

export default function CookiesPage() {
  return (
    <LegalPage title="Política de cookies" updatedAt="01/10/2026">
      <section>
        <h2>O que usamos</h2>
        <p>O WebZen usa apenas o necessário para funcionar. Não usamos cookies de publicidade nem de análise de terceiros, por isso não exibimos banner de consentimento.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-muted text-left text-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Nome</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Tipo</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Para quê</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Duração</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2.5 font-mono text-xs">sid</td>
                <td className="px-4 py-2.5">Cookie essencial</td>
                <td className="px-4 py-2.5">Mantém você conectado ao painel com segurança.</td>
                <td className="px-4 py-2.5">Até 14 dias ou 72 h sem uso</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-mono text-xs">webzen-theme</td>
                <td className="px-4 py-2.5">Armazenamento do navegador</td>
                <td className="px-4 py-2.5">Lembra se você prefere o tema claro ou escuro.</td>
                <td className="px-4 py-2.5">Até você limpar os dados do navegador</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Pagamentos</h2>
        <p>A tela de pagamento é da Stripe, em domínio próprio, e segue a política de cookies dela.</p>
      </section>
    </LegalPage>
  );
}
