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
            <div className="pointer-events-none absolute -top-12 z-10 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white group-hover:block">
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

export function UsageMeter({ label, current, limit, state }: { label: string; current: number; limit: number | null; state: string }) {
  const percent = limit ? Math.min(100, (current / limit) * 100) : 0;
  const color = state === 'LIMIT_REACHED' ? 'bg-red-500' : state === 'WARNING' ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="tabular-nums text-muted">
          {formatNumber(Math.round(current * 100) / 100)} {limit !== null ? `/ ${formatNumber(limit)}` : '· ilimitado'}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${limit ? percent : 4}%` }} />
      </div>
    </div>
  );
}
