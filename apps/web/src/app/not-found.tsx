import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Link href="/" className="mb-12 text-foreground" aria-label="WebZen — página inicial">
        <Logo />
      </Link>
      <p className="font-display text-7xl font-extrabold tracking-tight text-brand-200">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-foreground">Esta página não existe</h1>
      <p className="mt-2 max-w-sm text-muted">O endereço pode ter mudado ou estar digitado errado.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Ir para o início</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/app">Abrir o painel</Link>
        </Button>
      </div>
    </main>
  );
}
