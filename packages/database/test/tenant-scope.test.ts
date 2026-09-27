import { describe, expect, it } from 'vitest';
import { applyTenantScope, TenantScopeViolation } from '../src/tenant';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';

describe('applyTenantScope', () => {
  it('injeta companyId em consultas', () => {
    expect(applyTenantScope('Contact', 'findMany', { where: { name: 'João' } }, A)).toEqual({
      where: { name: 'João', companyId: A },
    });
    expect(applyTenantScope('Contact', 'findUnique', { where: { id: 'x' } }, A)).toEqual({
      where: { id: 'x', companyId: A },
    });
    expect(applyTenantScope('Contact', 'count', undefined, A)).toEqual({ where: { companyId: A } });
  });

  it('recusa filtro explícito por outra empresa', () => {
    expect(() => applyTenantScope('Contact', 'findMany', { where: { companyId: B } }, A)).toThrow(
      TenantScopeViolation,
    );
  });

  it('injeta companyId na criação e recusa outra empresa', () => {
    expect(applyTenantScope('Contact', 'create', { data: { phone: '55' } }, A)).toEqual({
      data: { phone: '55', companyId: A },
    });
    expect(() =>
      applyTenantScope('Contact', 'create', { data: { phone: '55', companyId: B } }, A),
    ).toThrow(TenantScopeViolation);
    expect(() =>
      applyTenantScope(
        'Contact',
        'create',
        { data: { phone: '55', company: { connect: { id: B } } } },
        A,
      ),
    ).toThrow(TenantScopeViolation);
  });

  it('aplica escopo em createMany', () => {
    const result = applyTenantScope(
      'Tag',
      'createMany',
      { data: [{ name: 'a' }, { name: 'b' }] },
      A,
    );
    expect(result.data).toEqual([
      { name: 'a', companyId: A },
      { name: 'b', companyId: A },
    ]);
  });

  it('impede mover registro para outra empresa em update/upsert', () => {
    expect(() =>
      applyTenantScope('Contact', 'update', { where: { id: 'x' }, data: { companyId: B } }, A),
    ).toThrow(TenantScopeViolation);
    expect(() =>
      applyTenantScope(
        'Contact',
        'upsert',
        { where: { id: 'x' }, create: { phone: '1' }, update: { companyId: B } },
        A,
      ),
    ).toThrow(TenantScopeViolation);
    const upsert = applyTenantScope(
      'Contact',
      'upsert',
      { where: { id: 'x' }, create: { phone: '1' }, update: { name: 'y' } },
      A,
    );
    expect(upsert).toEqual({
      where: { id: 'x', companyId: A },
      create: { phone: '1', companyId: A },
      update: { name: 'y' },
    });
  });

  it('bloqueia modelos que não pertencem a empresas', () => {
    expect(() => applyTenantScope('User', 'findMany', {}, A)).toThrow(TenantScopeViolation);
    expect(() => applyTenantScope('Company', 'findMany', {}, A)).toThrow(TenantScopeViolation);
    expect(() => applyTenantScope('Session', 'findMany', {}, A)).toThrow(TenantScopeViolation);
  });
});
