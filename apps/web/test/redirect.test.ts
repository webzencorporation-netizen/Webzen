import { describe, expect, it } from 'vitest';
import { safeNextPath } from '../src/lib/redirect';

describe('safeNextPath', () => {
  it.each([
    ['/convite?token=abc', '/convite?token=abc'],
    ['/app', '/app'],
    ['https://evil.test', null],
    ['//evil.test/x', null],
    ['/\\evil.test', null],
    ['javascript:alert(1)', null],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
