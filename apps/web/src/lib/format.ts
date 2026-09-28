const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });
const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const currencyBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const currencyUSD = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyUSDSmall = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const integer = new Intl.NumberFormat('pt-BR');

export const formatDateTime = (value: string | Date | null | undefined) => (value ? dateTime.format(new Date(value)) : '—');
export const formatDate = (value: string | Date | null | undefined) => (value ? date.format(new Date(value)) : '—');
export const formatTime = (value: string | Date | null | undefined) => (value ? time.format(new Date(value)) : '');
export const formatMoneyCents = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : currencyBRL.format(cents / 100));
/** Custos de IA: valores pequenos (< US$ 1) com 4 casas para não virarem "US$ 0,00". */
export const formatUsd = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : Math.abs(value) > 0 && Math.abs(value) < 1 ? currencyUSDSmall.format(value) : currencyUSD.format(value);
export const formatNumber = (value: number | null | undefined) => (value === null || value === undefined ? '—' : integer.format(value));

/** "há 5 min", "ontem", "12/03" — para listas de conversas. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '';
  const target = new Date(value);
  const diff = Date.now() - target.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const today = new Date();
  if (target.toDateString() === today.toDateString()) return time.format(target);
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (target.toDateString() === yesterday.toDateString()) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(target);
}

/** 5511987654321 → +55 11 98765-4321 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(value);
  if (match) return `+55 ${match[1]} ${match[2]}-${match[3]}`;
  return /^\d+$/.test(value) ? `+${value}` : value;
}

export function initials(name: string | null | undefined): string {
  if (!name || /^[\d+\s()-]+$/.test(name)) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}
