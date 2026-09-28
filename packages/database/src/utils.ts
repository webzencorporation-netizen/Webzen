import { Prisma } from './generated/prisma/client';

/** Converte Decimal do Prisma (ou null) em number para serialização JSON. */
export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export function isTransactionConflictError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
  // Prisma 7 converte conflitos de queries em P2034, mas o adapter-pg pode
  // propagar diretamente DriverAdapterError quando a falha acontece no COMMIT.
  if (!(error instanceof Error) || error.name !== 'DriverAdapterError') return false;
  const cause = error.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'kind' in cause &&
    cause.kind === 'TransactionWriteConflict' &&
    'originalCode' in cause &&
    (cause.originalCode === '40001' || cause.originalCode === '40P01')
  );
}
