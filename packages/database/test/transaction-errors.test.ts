import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import { isTransactionConflictError } from '../src/utils';

describe('conflitos de transação Prisma/pg', () => {
  it('reconhece P2034 retornado durante uma operação Prisma', () => {
    expect(
      isTransactionConflictError(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code: 'P2034',
          clientVersion: '7.10.0',
        }),
      ),
    ).toBe(true);
  });

  it.each(['40001', '40P01'])('reconhece a forma do adapter-pg no commit: %s', (originalCode) => {
    // Formato observado na suíte concorrente e no DriverAdapterError da versão instalada.
    const error = new Error('TransactionWriteConflict', {
      cause: {
        originalCode,
        kind: 'TransactionWriteConflict',
        originalMessage: 'could not serialize access',
      },
    });
    error.name = 'DriverAdapterError';
    expect(isTransactionConflictError(error)).toBe(true);
  });

  it.each([
    new Error('TransactionWriteConflict'),
    Object.assign(new Error('connection failed'), {
      name: 'DriverAdapterError',
      cause: { kind: 'ConnectionClosed', originalCode: '08003' },
    }),
    Object.assign(new Error('constraint failed'), {
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation', originalCode: '23505' },
    }),
    { code: 'P2034' },
    null,
  ])('não repete erros sem confirmação de conflito transacional: %#', (error) => {
    expect(isTransactionConflictError(error)).toBe(false);
  });
});
