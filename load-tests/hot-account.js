import { check } from 'k6';
import {
  assertLedgerBalanced,
  classify,
  createAccount,
  createUser,
  deposit,
  provisionAccounts,
  transfer,
} from './lib/api.js';

export const options = {
  scenarios: {
    hot_account: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '40s', target: 10 },
        { duration: '20s', target: 40 },
        { duration: '40s', target: 40 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    ledger_fault_rate: ['rate==0'],

    ledger_transfer_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const RECIPIENTS = 40;

export function setup() {
  const userId = createUser();

  const source = createAccount(userId);

  deposit(source, 500_000_000);

  const recipients = provisionAccounts(RECIPIENTS, 0);

  return { source, recipients };
}

export default function run(data) {
  const recipient = data.recipients[(__VU - 1) % data.recipients.length];

  const response = transfer(data.source, recipient, 10);
  const outcome = classify(response, 'hot account transfer');

  check(response, {
    'transfer accepted or cleanly rejected': () => outcome === 'ok' || outcome === 'rejected',

    'not starved by lock timeout': () => outcome !== 'contended',
  });
}

export function teardown() {
  assertLedgerBalanced();
}
