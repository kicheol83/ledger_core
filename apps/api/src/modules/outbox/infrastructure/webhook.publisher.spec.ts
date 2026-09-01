import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignature } from './webhook.publisher.js';

const secret = 'a-secret-at-least-sixteen-chars';

function signedAt(timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('verifySignature', () => {
  const now = (): number => Math.floor(Date.now() / 1000);

  it('accepts a correct signature', () => {
    const timestamp = now();
    const body = JSON.stringify({ id: '1', type: 'transfer.completed' });

    expect(
      verifySignature({
        secret,
        timestamp: String(timestamp),
        body,
        signature: signedAt(timestamp, body),
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const timestamp = now();
    const body = JSON.stringify({ amount: '100' });
    const signature = signedAt(timestamp, body);

    expect(
      verifySignature({
        secret,
        timestamp: String(timestamp),
        body: JSON.stringify({ amount: '999999' }),
        signature,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const timestamp = now();
    const body = '{}';
    const forged = createHmac('sha256', 'wrong-secret-wrong')
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(verifySignature({ secret, timestamp: String(timestamp), body, signature: forged })).toBe(
      false,
    );
  });

  it('rejects a replayed old signature', () => {
    const old = now() - 3_600;
    const body = '{}';

    expect(
      verifySignature({
        secret,
        timestamp: String(old),
        body,
        signature: signedAt(old, body),
      }),
    ).toBe(false);
  });

  it('accepts within the tolerance window', () => {
    const recent = now() - 60;
    const body = '{}';

    expect(
      verifySignature({
        secret,
        timestamp: String(recent),
        body,
        signature: signedAt(recent, body),
      }),
    ).toBe(true);
  });

  it('rejects a malformed timestamp', () => {
    expect(
      verifySignature({ secret, timestamp: 'not-a-number', body: '{}', signature: 'aa' }),
    ).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    const timestamp = now();

    expect(
      verifySignature({ secret, timestamp: String(timestamp), body: '{}', signature: 'ab' }),
    ).toBe(false);
  });
});
