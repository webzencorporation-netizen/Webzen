import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/site/legal-page';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: 'Política de privacidade', alternates: { canonical: '/privacidade' } };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade" updatedAt="01/10/2026">
      <section>
        <h2>Papéis no tratamento de dados</h2>
        <p>
          Para os dados da conta (nome, e-mail, empresa) o WebZen decide como tratá-los. Para os dados dos clientes finais que conversam com a empresa pelo WhatsApp, a empresa contratante é quem decide a finalidade, e o WebZen trata esses dados em nome dela, conforme a LGPD.
        </p>
      </section>
      <section>
        <h2>Dados tratados</h2>
        <ul>
          <li>Conta: nome, e-mail, senha (guardada só como hash), empresa, papel na equipe, registros de acesso (IP, navegador e data).</li>
          <li>Empresa: dados cadastrais, serviços, preços, horários e conteúdos da base de conhecimento.</li>
          <li>Atendimento: contatos, mensagens, mídias, agendamentos e notas criados no uso do serviço.</li>
          <li>Cobrança: plano, faturas e situação dos pagamentos. Dados de cartão ficam com o processador de pagamentos, não no WebZen.</li>
        </ul>
      </section>
      <section>
        <h2>Para que usamos</h2>
        <ul>
          <li>Prestar o serviço contratado: atendimento automático, agenda, CRM, automações e relatórios.</li>
          <li>Segurança: autenticação, prevenção de abuso e registro de ações administrativas.</li>
          <li>Cobrança e avisos operacionais por e-mail e no painel.</li>
        </ul>
        <p>Não vendemos dados e não usamos as conversas para publicidade.</p>
      </section>
      <section>
        <h2>Com quem compartilhamos</h2>
        <p>Só com fornecedores necessários para o serviço funcionar: a Meta (WhatsApp Business), o provedor de inteligência artificial que gera as respostas, o processador de pagamentos, a infraestrutura de banco de dados e armazenamento em nuvem e o serviço de envio de e-mail.</p>
      </section>
      <section>
        <h2>Segurança e retenção</h2>
        <p>Os dados de cada empresa ficam isolados, credenciais de integração são criptografadas e o acesso da equipe segue permissões por função. A empresa pode definir um prazo de retenção das mensagens e excluir contatos e conversas pelo painel.</p>
      </section>
      <section>
        <h2>Seus direitos</h2>
        <p>
          Você pode pedir acesso, correção, exportação ou exclusão dos seus dados. Clientes finais devem procurar primeiro a empresa com quem conversaram. Pedidos e dúvidas: <a href={`mailto:${SITE.supportEmail}`} className="text-brand-700 underline">{SITE.supportEmail}</a>.
        </p>
        <p>
          Sobre cookies, veja a <Link href="/cookies" className="text-brand-700 underline">política de cookies</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
