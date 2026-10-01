'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/#solucoes', label: 'Soluções' },
  { href: '/#como-funciona', label: 'Como funciona' },
  { href: '/precos', label: 'Preços' },
  { href: '/#perguntas', label: 'Perguntas' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="text-foreground" aria-label="WebZen — página inicial">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Site">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-slate-600 transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild>
            <Link href="/cadastro">Começar agora</Link>
          </Button>
        </div>
        <button className="rounded-md p-2 text-slate-600 md:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="menu-site" aria-label={open ? 'Fechar menu' : 'Abrir menu'}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <nav id="menu-site" className="border-t border-border bg-canvas px-4 pb-5 pt-3 md:hidden" aria-label="Site">
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-100">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button asChild variant="secondary">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild>
              <Link href="/cadastro">Começar agora</Link>
            </Button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
