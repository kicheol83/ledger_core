import { createHash } from 'node:crypto';

export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalise(entry)]),
    );
  }

  return value;
}

export function hashRequest(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(body) ?? null))
    .digest('hex');
}
