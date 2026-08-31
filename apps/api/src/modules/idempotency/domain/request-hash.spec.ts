import { describe, expect, it } from 'vitest';
import { canonicalise, hashRequest } from './request-hash.js';

describe('canonicalise', () => {
  it('sorts object keys', () => {
    expect(canonicalise({ b: 2, a: 1 })).toEqual({ a: 1, b: 2 });
  });

  it('sorts nested objects', () => {
    const result = canonicalise({ outer: { z: 1, a: 2 } });
    expect(JSON.stringify(result)).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array order', () => {
    expect(JSON.stringify(canonicalise([2, 1]))).toBe('[2,1]');
  });

  it('drops undefined values', () => {
    expect(canonicalise({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('keeps null, which is meaningful', () => {
    expect(canonicalise({ a: null })).toEqual({ a: null });
  });
});

describe('hashRequest', () => {
  it('is stable across key ordering', () => {
    expect(hashRequest({ amount: '100', currency: 'UZS' })).toBe(
      hashRequest({ currency: 'UZS', amount: '100' }),
    );
  });

  it('changes when a value changes', () => {
    expect(hashRequest({ amount: '100' })).not.toBe(hashRequest({ amount: '200' }));
  });

  it('distinguishes a string from a number', () => {
    expect(hashRequest({ amount: '100' })).not.toBe(hashRequest({ amount: 100 }));
  });

  it('handles an empty body', () => {
    expect(hashRequest({})).toBe(hashRequest({}));
    expect(hashRequest(undefined)).toBe(hashRequest(undefined));
  });

  it('distinguishes an empty body from a missing one', () => {
    expect(hashRequest({})).not.toBe(hashRequest(undefined));
  });
});
