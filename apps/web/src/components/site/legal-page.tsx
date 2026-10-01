import type { ReactNode } from 'react';

/** Página institucional de texto (termos, privacidade, cookies), com largura de leitura confortável. */
export function LegalPage({ title, updatedAt, children }: { title: string; updatedAt: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">{title}</h1>
      <p className="mt-3 text-sm text-muted">Última atualização: {updatedAt}</p>
      <div role="note" className="mt-8 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
        Versão provisória, em revisão jurídica. Descreve como o WebZen funciona hoje e pode mudar antes da versão definitiva; mudanças relevantes serão avisadas no painel.
      </div>
      <div className="mt-10 space-y-8 leading-relaxed text-slate-700 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5">{children}</div>
    </article>
  );
}
