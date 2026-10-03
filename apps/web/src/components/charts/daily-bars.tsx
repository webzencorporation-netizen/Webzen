import { usageThresholdReached } from '@botsaas/shared';
import { formatNumber } from '@/lib/format';

export interface DailyPoint {
  day: string;
  inbound: number;
  outbound: number;
}

/** Barras agrupadas simples (recebidas × respondidas) sem dependências de gráficos. */
export function DailyBars({ data }: { data: DailyPoint[] }) {
  const max = Math.max(1, ...data.map((point) => Math.max(point.inbound, point.outbound)));
  return (
    <div>
      <div className="flex h-44 items-end gap-1" role="img" aria-label="Mensagens por dia">
        {data.map((point) => (
          <div key={point.day} className="group relative flex h-full flex-1 items-end justify-center gap-[2px]">
            <div className="w-1/2 rounded-t bg-slate-300 transition group-hover:bg-slate-400" style={{ height: `${(point.inbound / max) * 100}%` }} />
            <div className="w-1/2 rounded-t bg-brand-500 transition group-hover:bg-brand-600" style={{ height: `${(point.outbound / max) * 100}%` }} />
            <div className="pointer-events-none absolute -top-12 z-10 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white group-hover:block">
              {point.day.slice(8, 10)}/{point.day.slice(5, 7)} · {formatNumber(point.inbound)} recebidas · {formatNumber(point.outbound)} enviadas
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{data[0] ? `${data[0].day.slice(8, 10)}/${data[0].day.slice(5, 7)}` : ''}</span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> Recebidas</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand-500" /> Enviadas</span>
        </span>
        <span>{data.at(-1) ? `${data.at(-1)?.day.slice(8, 10)}/${data.at(-1)?.day.slice(5, 7)}` : ''}</span>
      </div>
    </div>
  );
}

/** Consumo de uma métrica do plano. Cores pelos limiares de aviso (70/90/100%). */
export function UsageMeter({ label, current, limit }: { label: string; current: number; limit: number | null; state?: string }) {
  const value = Math.round(current * 100) / 100;
  const threshold = usageThresholdReached(value, limit);
  const percent = limit ? Math.min(100, (value / limit) * 100) : 0;
  const color = threshold >= 100 ? 'bg-red-500' : threshold >= 90 ? 'bg-orange-500' : threshold >= 70 ? 'bg-hour' : 'bg-brand-500';
  return (
    <div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="tabular-nums text-muted">{limit !== null ? `${formatNumber(value)} de ${formatNumber(limit)}` : `${formatNumber(value)} · ilimitado`}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={value}
        aria-valuetext={limit !== null ? `Você utilizou ${formatNumber(value)} de ${formatNumber(limit)}` : `${formatNumber(value)}, sem limite`}
      >
        <div className={`h-full rounded-full transition-[width] ${color}`} style={{ width: `${limit ? Math.max(percent, value > 0 ? 2 : 0) : 4}%` }} />
      </div>
      {threshold >= 100 ? <p className="mt-1 text-xs text-red-700">Limite do plano atingido.</p> : null}
    </div>
  );
}
