import type { Metadata } from 'next';
import { StatusBoard } from '@/components/site/status-board';

export const metadata: Metadata = {
  title: 'Status do sistema',
  description: 'Situação atual do site, da API, do atendimento automático, do WhatsApp e dos provedores de IA do WebZen.',
  alternates: { canonical: '/status' },
};

export default function StatusPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">Status do sistema</h1>
      <p className="mt-3 text-muted">Atualizado automaticamente a cada minuto.</p>
      <StatusBoard />
    </section>
  );
}
