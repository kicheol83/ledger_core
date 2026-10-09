import http from 'k6/http';
import { check } from 'k6';
import { assertLedgerBalanced, BASE_URL, classify, headers, provisionAccounts, transfer } from './lib/api.js';

const READ_RATE = Number(__ENV.READ_RATE || 0);

const reads = READ_RATE
  ? {
      executor: 'constant-arrival-rate',
      rate: READ_RATE,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 30,
      maxVUs: 60,
      exec: 'readPath',
    }
  : {
      executor: 'constant-vus',
      vus: 30,
      duration: '2m',
      exec: 'readPath',
    };

export const options = {
  scenarios: {
    reads,
    writes: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'writePath',
    },
  },
  thresholds: {
    ledger_fault_rate: ['rate==0'],

    'http_req_duration{operation:balance}': ['p(95)<80'],
    'http_req_duration{operation:history}': ['p(95)<120'],
    ledger_transfer_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const ACCOUNTS = 50;

export function setup() {
  const accounts = provisionAccounts(ACCOUNTS, 50_000_000);
  return { accounts };
}

export function readPath(data) {
  const accountId = data.accounts[Math.floor(Math.random() * data.accounts.length)];

  const balance = http.get(`${BASE_URL}/accounts/${accountId}/balance`, {
    tags: { operation: 'balance' },
  });

  check(balance, { 'balance read': (r) => r.status === 200 });

  const history = http.get(`${BASE_URL}/transactions?accountId=${accountId}&limit=20`, {
    tags: { operation: 'history' },
  });

  check(history, { 'history read': (r) => r.status === 200 });
}

export function writePath(data) {
  const fromIndex = Math.floor(Math.random() * data.accounts.length);
  let toIndex = Math.floor(Math.random() * data.accounts.length);
  while (toIndex === fromIndex) {
    toIndex = Math.floor(Math.random() * data.accounts.length);
  }

  const response = transfer(data.accounts[fromIndex], data.accounts[toIndex], 50);
  classify(response, 'mixed transfer');

  if (__ITER % 10 === 0) {
    const deposit = http.post(
      `${BASE_URL}/deposits`,
      JSON.stringify({
        accountId: data.accounts[fromIndex],
        amount: '1000',
        currency: 'UZS',
      }),
      { headers: headers(), tags: { operation: 'deposit' } },
    );

    classify(deposit, 'mixed deposit');
  }
}

export function teardown() {
  assertLedgerBalanced();
}
