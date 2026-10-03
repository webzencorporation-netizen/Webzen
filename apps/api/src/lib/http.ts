import { z } from 'zod';

/** Paginação padrão da API. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toSkipTake({ page, pageSize }: PaginationQuery) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginated<T>(items: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export const idParamSchema = z.object({ id: z.uuid() });

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/** Converte string vazia em undefined (formulários). */
export const optionalText = (max = 500) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((value) =>
      value === undefined || value === null || value.trim() === '' ? null : value.trim(),
    );

type WithoutDefaults<T extends z.ZodRawShape> = {
  [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K];
};

/**
 * Schema de PATCH: todos os campos opcionais e SEM os `.default()` do schema de criação.
 * No Zod 4, `.partial()` mantém os defaults — um PATCH só com `name` regravaria os valores
 * padrão por cima dos atuais (ex.: reativar uma automação e apagar as condições dela).
 */
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => [
      key,
      value instanceof z.ZodDefault ? value.unwrap() : value,
    ]),
  ) as WithoutDefaults<T>;
  return z.object(shape).partial();
}
