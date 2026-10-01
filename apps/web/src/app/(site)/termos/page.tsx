import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/legal-page';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: 'Termos de uso', alternates: { canonical: '/termos' } };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso" updatedAt="01/10/2026">
      <section>
        <h2>1. O serviço</h2>
        <p>O WebZen é uma plataforma de atendimento com inteligência artificial no WhatsApp, com CRM, agenda e automações, contratada por empresas (“Cliente”) mediante assinatura.</p>
      </section>
      <section>
        <h2>2. Conta e acesso</h2>
        <p>O Cliente é responsável pelas pessoas que convida para a equipe e pelas permissões atribuídas a cada uma. Senhas são pessoais. Avise o suporte se suspeitar de acesso indevido.</p>
      </section>
      <section>
        <h2>3. Assinatura e cobrança</h2>
        <ul>
          <li>Planos mensais ou anuais, cobrados antecipadamente pelo processador de pagamentos.</li>
          <li>Troca de plano a qualquer momento, com valor proporcional calculado no momento da troca.</li>
          <li>Cancelamento pelo painel, com efeito no fim do período já pago.</li>
          <li>Com pagamento pendente, as respostas automáticas podem ser pausadas; os dados continuam acessíveis no painel.</li>
          <li>Tarifas do WhatsApp Business são da Meta e não fazem parte da assinatura.</li>
        </ul>
      </section>
      <section>
        <h2>4. Uso adequado</h2>
        <p>O Cliente se compromete a usar o WhatsApp conforme as políticas da Meta, a não enviar spam nem conteúdo ilícito e a manter atualizadas as informações que o atendente usa (preços, horários, serviços).</p>
      </section>
      <section>
        <h2>5. Inteligência artificial</h2>
        <p>As respostas são geradas por modelos de IA a partir das informações cadastradas pelo Cliente. Elas podem conter erros; o Cliente pode revisar as conversas, assumir o atendimento a qualquer momento e ajustar as instruções do atendente.</p>
      </section>
      <section>
        <h2>6. Limites do plano</h2>
        <p>Cada plano tem limites de uso descritos na página de preços. Ao atingir um limite, o recurso correspondente fica indisponível até a renovação ou a contratação de um plano maior.</p>
      </section>
      <section>
        <h2>7. Contato</h2>
        <p>
          Dúvidas sobre estes termos: <a href={`mailto:${SITE.supportEmail}`} className="text-brand-700 underline">{SITE.supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
