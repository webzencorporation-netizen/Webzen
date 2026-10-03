import { cn } from '@/lib/cn';

/**
 * Marca do WebZen: um ensō (círculo zen pintado num só gesto, aberto no fim) — calma e
 * continuidade, o atendimento que não para. O traço usa a cor atual (`currentColor`).
 */
export function EnsoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('h-6 w-6', className)} fill="none">
      <path
        d="M24.5 8.2A11 11 0 1 0 27 17.6"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="27.1" cy="13" r="1.9" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight', className)}>
      <EnsoMark className={cn('text-brand-500', markClassName)} />
      WebZen
    </span>
  );
}
