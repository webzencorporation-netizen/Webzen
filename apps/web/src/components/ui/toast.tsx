'use client';

import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<{ push: (tone: ToastTone, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg',
              item.tone === 'success' ? 'border-brand-200' : 'border-red-200',
            )}
          >
            {item.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
            <p className="flex-1 text-slate-700">{item.message}</p>
            <button onClick={() => dismiss(item.id)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar aviso">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast fora do ToastProvider');
  const { push } = context;
  // Referência estável: pode ser usada em dependências de efeitos.
  return useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
    }),
    [push],
  );
}
