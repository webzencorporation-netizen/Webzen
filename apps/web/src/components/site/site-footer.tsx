import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { SITE } from '@/lib/site';

const COLUMNS = [
  {
    title: 'Produto',
    links: [
      { href: '/#solucoes', label: 'Soluções' },
      { href: '/#funcionalidades', label: 'Funcionalidades' },
      { href: '/#integracoes', label: 'Integrações' },
      { href: '/precos', label: 'Preços' },
      { href: '/novidades', label: 'Novidades' },
    ],
  },
  {
    title: 'Ajuda',
    links: [
      { href: '/#perguntas', label: 'Perguntas frequentes' },
      { href: '/docs/api', label: 'Documentação da API' },
      { href: `mailto:${SITE.supportEmail}`, label: 'Suporte' },
      { href: '/status', label: 'Status do sistema' },
    ],
  },
  {
    title: 'Conta',
    links: [
      { href: '/login', label: 'Entrar' },
      { href: '/cadastro', label: 'Criar conta' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/termos', label: 'Termos de uso' },
      { href: '/privacidade', label: 'Privacidade' },
      { href: '/cookies', label: 'Cookies' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_repeat(4,1fr)]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm leading-relaxed text-muted">Atendimento com IA no WhatsApp, CRM, agenda e automações para empresas que querem crescer sem aumentar a equipe.</p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted sm:px-6">© {new Date().getFullYear()} WebZen. Preços em reais (BRL).</p>
      </div>
    </footer>
  );
}
