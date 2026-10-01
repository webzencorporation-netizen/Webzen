/** Só caminhos internos: `next` nunca leva para outro domínio (sem redirecionamento aberto). */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
