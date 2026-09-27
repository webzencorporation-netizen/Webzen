/**
 * Normaliza telefone para dígitos E.164 sem "+" (formato usado pela Cloud API em `wa_id`).
 * Para números brasileiros sem DDI (10–11 dígitos) adiciona 55.
 */
export function normalizePhone(raw: string, defaultCountryCode = '55'): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (raw.trim().startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (defaultCountryCode === '55' && (digits.length === 10 || digits.length === 11))
    return `55${digits}`;
  return digits;
}

export function isPlausiblePhone(value: string): boolean {
  return /^\d{8,15}$/.test(value);
}

/** Exibição amigável (BR): 5511987654321 → +55 11 98765-4321 */
export function formatPhone(value: string): string {
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(value);
  if (match) return `+55 ${match[1]} ${match[2]}-${match[3]}`;
  return value ? `+${value}` : value;
}
