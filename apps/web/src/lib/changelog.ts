/**
 * Novidades do WebZen, da mais recente para a mais antiga. Fonte única da página /novidades:
 * para publicar uma novidade, acrescente uma entrada no topo.
 */
export interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-01',
    title: 'Planos, conta própria e integrações para empresas',
    items: [
      'Novos planos Starter, Pro e Business, com pagamento mensal ou anual (12 meses pelo preço de 10).',
      'Cadastro direto pelo site, confirmação de e-mail e recuperação de senha.',
      'Convites para a equipe por e-mail e tela de sessões ativas.',
      'Assinatura, faturas e consumo do plano com avisos em 70%, 90% e 100%.',
      'API pública, chaves de API e webhooks assinados no plano Business.',
      'Suporte por chamados dentro do painel e envio de feedback.',
      'Tema escuro e busca rápida com Ctrl + K.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Agenda sem reserva dupla e relatório de consumo',
    items: [
      'A agenda impede dois agendamentos no mesmo horário, mesmo com várias conversas ao mesmo tempo.',
      'Relatório de consumo da IA por dia e por modelo.',
      'Respostas mais naturais do atendente e recuperação automática de respostas travadas.',
    ],
  },
];
