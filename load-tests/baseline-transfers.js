import { check } from 'k6';
import {
  assertLedgerBalanced,
  classify,
  provisionAccounts,
  transfer,
} from './lib/api.js';

export const options = {
  scenarios: {
    baseline: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    ledger_fault_rate: ['rate==0'],

    ledger_transfer_duration: ['p(95)<150', 'p(99)<400'],

    ledger_contention: ['count==0'],
    http_req_failed: ['rate<0.01'],
  },
};

const VU_COUNT = 60;
const STARTING_BALANCE = 100_000_000;

export function setup() {
  const accounts = provisionAccounts(VU_COUNT * 2, STARTING_BALANCE);
  return { accounts };
}

export default function run(data) {
  const index = (__VU - 1) % VU_COUNT;
  const from = data.accounts[index * 2];
  const to = data.accounts[index * 2 + 1];

  const response = transfer(from, to, 100);
  const outcome = classify(response, 'baseline transfer');

  check(response, {
    'transfer accepted': () => outcome === 'ok',
  });
}

export function teardown() {
  assertLedgerBalanced();
}
