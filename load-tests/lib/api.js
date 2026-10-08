import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/v1';

export const succeeded = new Counter('ledger_succeeded');
export const rejected = new Counter('ledger_rejected_business');
export const contended = new Counter('ledger_contention');
export const faulted = new Counter('ledger_faults');

export const faultRate = new Rate('ledger_fault_rate');
export const transferDuration = new Trend('ledger_transfer_duration', true);

export function headers(idempotencyKey) {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey || uuidv4(),

    'X-Request-Id': `k6-${__VU}-${typeof __ITER === 'undefined' ? 'setup' : __ITER}-${Date.now()}`,
  };
}

export function classify(response, label) {
  const status = response.status;

  if (status >= 200 && status < 300) {
    succeeded.add(1);
    faultRate.add(false);
    return 'ok';
  }

  if (status === 422 || status === 404) {
    rejected.add(1);
    faultRate.add(false);
    return 'rejected';
  }

  if (status === 409) {
    contended.add(1);
    faultRate.add(false);
    return 'contended';
  }

  faulted.add(1);
  faultRate.add(true);
  console.error(`${label} fault: ${status} ${response.body}`);
  return 'fault';
}

export function createUser() {
  const response = http.post(
    `${BASE_URL}/users`,
    JSON.stringify({ email: `k6-${uuidv4()}@load.test` }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(response, { 'user created': (r) => r.status === 201 });
  return response.json('id');
}

export function createAccount(userId, currency = 'UZS') {
  const response = http.post(
    `${BASE_URL}/accounts`,
    JSON.stringify({ userId, currency }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(response, { 'account created': (r) => r.status === 201 });
  return response.json('id');
}

export function deposit(accountId, amount, currency = 'UZS') {
  const response = http.post(
    `${BASE_URL}/deposits`,
    JSON.stringify({ accountId, amount: String(amount), currency }),
    { headers: headers() },
  );

  check(response, { 'deposit accepted': (r) => r.status === 201 });
  return response;
}

export function transfer(from, to, amount, options = {}) {
  const response = http.post(
    `${BASE_URL}/transfers`,
    JSON.stringify({
      fromAccountId: from,
      toAccountId: to,
      amount: String(amount),
      currency: options.currency || 'UZS',
    }),
    { headers: headers(options.idempotencyKey), tags: { operation: 'transfer' } },
  );

  transferDuration.add(response.timings.duration);
  return response;
}

export function provisionAccounts(count, fundEach) {
  const userId = createUser();
  const accounts = [];

  for (let i = 0; i < count; i += 1) {
    const accountId = createAccount(userId);
    if (fundEach > 0) {
      deposit(accountId, fundEach);
    }
    accounts.push(accountId);
  }

  return accounts;
}

export function assertLedgerBalanced(currency = 'UZS') {
  const response = http.get(`${BASE_URL}/ledger/reconciliation?currency=${currency}`);

  const balanced = check(response, {
    'ledger still balances after load': (r) => r.status === 200 && r.json('balanced') === true,
  });

  if (!balanced) {
    console.error(`LEDGER IMBALANCE AFTER LOAD: ${response.body}`);
  }

  return balanced;
}
