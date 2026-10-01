/** Dados institucionais do WebZen usados no site público, metadados e e-mails do painel. */
export const SITE = {
  name: 'WebZen',
  tagline: 'Automatize seu negócio com inteligência',
  description:
    'Atendente com IA no WhatsApp, CRM, agenda e automações para pequenas e médias empresas. Atenda 24 horas sem aumentar a equipe.',
  url: process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'suporte@webzen.com.br',
} as const;
