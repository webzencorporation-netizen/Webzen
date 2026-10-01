import {
  Bell,
  BookOpen,
  CalendarDays,
  Code2,
  Globe,
  KanbanSquare,
  LayoutTemplate,
  Mail,
  MessageCircle,
  Plug,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroConversation } from '@/components/site/hero-conversation';
import { Pricing } from '@/components/site/pricing';
import { Button } from '@/components/ui/button';
import { fetchPublicPlans } from '@/lib/public-api';
import { SITE } from '@/lib/site';

export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
  description: SITE.description,
  alternates: { canonical: '/' },
};

const PLATFORM_SOLUTIONS = [
  {
    icon: MessageCircle,
    title: 'Atendente com IA no WhatsApp',
    text: 'Responde dúvidas, informa preços e horários e conversa no tom da sua marca, usando só as informações que você cadastrou.',
  },
  {
    icon: CalendarDays,
    title: 'Agenda que se preenche sozinha',
    text: 'O atendente oferece horários livres, marca, remarca e envia lembretes. Sem reserva dupla, mesmo com várias conversas ao mesmo tempo.',
  },
  {
    icon: KanbanSquare,
    title: 'CRM e funil de vendas',
    text: 'Cada conversa vira contato com histórico, etiquetas e etapa no funil. Sua equipe sabe quem está perto de fechar.',
  },
  {
    icon: Workflow,
    title: 'Automações do dia a dia',
    text: 'Quando chega um lead, quando um horário é cancelado, quando alguém pede um humano: o WebZen avisa, etiqueta e responde.',
  },
];

const CUSTOM_SOLUTIONS = [
  { icon: Globe, title: 'Sites e páginas profissionais', text: 'Página da empresa rápida, com SEO e o WhatsApp conectado ao atendimento.' },
  { icon: Code2, title: 'Sistemas sob medida', text: 'Ferramentas internas e integrações com o que a sua empresa já usa.' },
  { icon: LayoutTemplate, title: 'Geração de conteúdo', text: 'Textos de catálogo, respostas e campanhas a partir dos dados do seu negócio.' },
];

const STEPS = [
  { title: 'Escolha uma solução', text: 'Comece pelo plano que combina com o volume da sua empresa. Dá para trocar depois.' },
  { title: 'Configure sua empresa', text: 'Cadastre serviços, preços, horários e respostas frequentes. Modelos prontos para clínica, salão, restaurante, loja e imobiliária.' },
  { title: 'Conecte suas ferramentas', text: 'Ligue o número oficial do WhatsApp Business e, se quiser, o Google Agenda.' },
  { title: 'Deixe a automação trabalhar', text: 'Teste numa conversa simulada, publique e acompanhe tudo pelo painel. Quando precisar, a equipe assume a conversa.' },
];

const BENEFITS = [
  { title: 'Atendimento 24 horas', text: 'Quem chama às 23h recebe resposta na hora, não na manhã seguinte.' },
  { title: 'Respostas mais rápidas', text: 'Preço, horário e endereço respondidos em segundos, com os dados da empresa.' },
  { title: 'Menos trabalho manual', text: 'Agendar, confirmar e lembrar deixa de ocupar a recepção.' },
  { title: 'Clientes num só lugar', text: 'Conversas, contatos e histórico centralizados, com acesso por equipe.' },
  { title: 'Tarefas repetitivas automatizadas', text: 'Etiquetas, avisos e mensagens disparadas por eventos, sem planilha.' },
  { title: 'Acompanhamento de verdade', text: 'Painel com conversas, tempo de resposta e o que a IA resolveu sozinha.' },
];

const FEATURES = [
  { group: 'Atendimento', items: ['Respostas com IA no WhatsApp oficial', 'Passagem para atendente humano', 'Horário de funcionamento e mensagem fora do expediente', 'Teste o atendente antes de publicar'] },
  { group: 'Vendas', items: ['Contatos com histórico e etiquetas', 'Funil de vendas em kanban', 'Catálogo de produtos e serviços', 'Qualificação automática de leads'] },
  { group: 'Operação', items: ['Agenda com lembretes', 'Automações por evento', 'Base de conhecimento e perguntas frequentes', 'Equipe com papéis e permissões'] },
  { group: 'Controle', items: ['Métricas de atendimento', 'Consumo do plano com avisos', 'Registro de ações da equipe', 'Exportação de dados em CSV'] },
];

const INTEGRATIONS = [
  { icon: MessageCircle, name: 'WhatsApp Business', note: 'API oficial da Meta' },
  { icon: CalendarDays, name: 'Google Agenda', note: 'Plano Pro e Business' },
  { icon: Plug, name: 'Webhooks e API', note: 'Plano Business' },
  { icon: Mail, name: 'E-mail', note: 'Avisos e convites' },
  { icon: BookOpen, name: 'Documentos', note: 'PDF e textos na base de conhecimento' },
  { icon: Users, name: 'Instagram e Telegram', note: 'Em breve' },
];

const FAQ = [
  {
    q: 'Preciso trocar o número de WhatsApp da empresa?',
    a: 'Não necessariamente. O WebZen usa a API oficial do WhatsApp Business (Meta). Você pode usar um número novo ou migrar um número existente para a API, seguindo as regras da Meta.',
  },
  {
    q: 'A IA pode inventar preço ou horário?',
    a: 'O atendente responde com as informações cadastradas no painel e consulta a agenda e o catálogo em tempo real. Ele não marca horário ocupado nem cria preço que você não informou. Quando não sabe, avisa o cliente e chama sua equipe.',
  },
  {
    q: 'Minha equipe consegue assumir a conversa?',
    a: 'Sim. Qualquer atendente pode assumir uma conversa pelo painel, e a IA para de responder naquela conversa até ser devolvida.',
  },
  {
    q: 'Como funciona a cobrança?',
    a: 'Assinatura mensal ou anual no cartão de crédito, com as faturas disponíveis no painel. Você pode trocar de plano ou cancelar quando quiser; o cancelamento vale no fim do período já pago.',
  },
  {
    q: 'O que acontece se eu passar do limite do plano?',
    a: 'Você recebe avisos ao chegar em 70% e 90% do limite. Ao atingir 100%, as respostas automáticas pausam até a renovação ou um upgrade, e as conversas seguem para a sua equipe.',
  },
  {
    q: 'Meus dados ficam separados das outras empresas?',
    a: 'Sim. Cada empresa tem seus dados isolados no sistema, credenciais de integração são guardadas criptografadas e cada pessoa da equipe só acessa o que a função dela permite.',
  },
];

export default async function HomePage() {
  const plans = await fetchPublicPlans();
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: SITE.description,
    url: SITE.url,
    ...(plans
      ? {
          offers: plans.map((plan) => ({
            '@type': 'Offer',
            name: plan.name,
            price: (plan.priceMonthlyCents / 100).toFixed(2),
            priceCurrency: plan.currency,
          })),
        }
      : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />

      {/* Herói: a noite em que o atendimento continua. */}
      <section className="bg-ink-deep text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.5rem]">Automatize seu negócio com inteligência.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              O WebZen atende seus clientes no WhatsApp com IA, marca horários, organiza contatos e chama sua equipe quando precisa. A qualquer hora, com as informações da sua empresa.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-brand-500 hover:bg-brand-400">
                <Link href="/cadastro">Começar agora</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="text-white ring-1 ring-white/25 hover:bg-white/10 hover:text-white">
                <Link href="#solucoes">Conhecer soluções</Link>
              </Button>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand-400" aria-hidden /> API oficial do WhatsApp
              </li>
              <li className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-brand-400" aria-hidden /> Sua equipe assume quando quiser
              </li>
            </ul>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroConversation />
          </div>
        </div>
      </section>

      <section id="solucoes" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Tudo o que o atendimento da sua empresa precisa, num painel só.</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">A plataforma cuida do dia a dia. Para o que é específico do seu negócio, a equipe WebZen desenvolve junto com você.</p>
          <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {PLATFORM_SOLUTIONS.map((item) => (
              <div key={item.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <item.icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-slate-600">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-16 rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <h3 className="font-display text-xl font-bold text-foreground">Sob medida com a equipe WebZen</h3>
                <p className="mt-1 text-slate-600">Projetos à parte da assinatura, orçados conforme o escopo.</p>
              </div>
              <Button asChild variant="secondary">
                <a href={`mailto:${SITE.supportEmail}?subject=Projeto%20sob%20medida`}>Falar com a equipe</a>
              </Button>
            </div>
            <ul className="mt-6 grid gap-6 md:grid-cols-3">
              {CUSTOM_SOLUTIONS.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                  <div>
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-20 border-y border-border bg-surface py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Do cadastro à primeira conversa atendida</h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative">
                <span className="font-display text-5xl font-extrabold text-brand-200" aria-hidden>
                  {index + 1}
                </span>
                <h3 className="mt-3 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">O que muda na rotina</h2>
            <p className="mt-4 text-lg text-muted">Menos tempo respondendo a mesma pergunta. Mais tempo atendendo quem já está na sua porta.</p>
          </div>
          <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="border-l-2 border-brand-500 pl-4">
                <dt className="font-semibold text-foreground">{benefit.title}</dt>
                <dd className="mt-1 text-slate-600">{benefit.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="funcionalidades" className="scroll-mt-20 border-y border-border bg-surface py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Funcionalidades</h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((column) => (
              <div key={column.group}>
                <h3 className="text-sm font-semibold text-brand-700">{column.group}</h3>
                <ul className="mt-4 space-y-3">
                  {column.items.map((item) => (
                    <li key={item} className="text-slate-700">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="integracoes" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Integrações</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">Conexões oficiais, com credenciais guardadas criptografadas.</p>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {INTEGRATIONS.map((integration) => (
              <li key={integration.name} className="flex items-center gap-4 bg-surface p-5">
                <integration.icon className="h-6 w-6 shrink-0 text-slate-500" aria-hidden />
                <div>
                  <p className="font-medium text-foreground">{integration.name}</p>
                  <p className="text-sm text-muted">{integration.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="planos" className="scroll-mt-20 border-y border-border bg-surface-muted py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Planos</h2>
            <p className="mt-4 text-lg text-muted">Sem taxa de implantação. No plano anual, você paga 10 meses e usa 12.</p>
          </div>
          <div className="mt-10">
            {plans && plans.length > 0 ? (
              <Pricing plans={plans} />
            ) : (
              <p className="text-center text-muted">
                Os preços não carregaram agora.{' '}
                <Link href="/precos" className="text-brand-700 underline">
                  Ver página de preços
                </Link>
              </p>
            )}
          </div>
          <p className="mt-8 text-center text-sm text-muted">
            <Link href="/precos" className="font-medium text-brand-700 hover:underline">
              Comparar todos os recursos dos planos
            </Link>
          </p>
        </div>
      </section>

      <section id="perguntas" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Perguntas frequentes</h2>
          <div className="mt-10 divide-y divide-border border-y border-border">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium text-foreground marker:hidden">
                  {item.q}
                  <span className="text-2xl leading-none text-brand-600 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ink-deep py-20 text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 sm:px-6 lg:flex-row lg:items-center">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Hoje à noite, quem vai responder seus clientes?</h2>
            <p className="mt-3 text-lg text-white/70">Crie a conta, configure o atendente e teste antes de publicar.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-brand-500 hover:bg-brand-400">
              <Link href="/cadastro">Começar agora</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-white ring-1 ring-white/25 hover:bg-white/10 hover:text-white">
              <Link href="/precos">Ver preços</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
