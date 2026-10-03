import type { ApiErrorBody } from '@botsaas/shared';

/** Erro de API com mensagem já amigável (vinda do backend, sem stack trace). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Evento disparado quando o plano barra uma ação (limite ou recurso fora do plano). */
export const PLAN_LIMIT_EVENT = 'webzen:plan-limit';
const PLAN_LIMIT_CODES = new Set(['LIMIT_REACHED', 'FEATURE_DISABLED']);

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query; formData?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'botsaas-web' };
  let body: BodyInit | undefined;
  if (options.formData) body = options.formData;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(withQuery(`/api${path}`, options.query), { method, headers, body, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
    // Só ações (não leituras): uma tela que consulta um recurso fora do plano não abre aviso sozinha.
    if (method !== 'GET' && error && PLAN_LIMIT_CODES.has(error.code) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<string>(PLAN_LIMIT_EVENT, { detail: error.message }));
    }
    throw new ApiError(error?.message ?? 'Não foi possível completar a ação.', response.status, error?.code, error?.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData) => request<T>('POST', path, { formData }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Algo deu errado. Tente novamente.';
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
