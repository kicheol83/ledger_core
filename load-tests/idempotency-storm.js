import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { assertLedgerBalanced, BASE_URL, classify, provisionAccounts, transfer } from './lib/api.js';

const replays = new Counter('idempotent_replays');
const originals = new Counter('idempotent_originals');

export const options = {
  scenarios: {
    storm: {
      executor: 'per-vu-iterations',
      vus: 30,
      iterations: 20,
      maxDuration: '3m',
    },
  },
  thresholds: {
    ledger_fault_rate: ['rate==0'],
    http_req_failed: ['rate<0.01'],
  },
};

const COPIES = 3;
const AMOUNT = 100;
const KEYS_PER_VU = 20;

export function setup() {
  const accounts = provisionAccounts(2, 100_000_000);
  return { from: accounts[0], to: accounts[1] };
}

export default function run(data) {
  const key = `k6-storm-${__VU}-${__ITER}-${uuidv4().slice(0, 8)}`;

  for (let copy = 0; copy < COPIES; copy += 1) {
    const response = transfer(data.from, data.to, AMOUNT, { idempotencyKey: key });
    classify(response, 'idempotent transfer');

    if (response.status === 201) {
      if (response.headers['Idempotent-Replay'] === 'true') {
        replays.add(1);
      } else {
        originals.add(1);
      }
    }
  }
}

export function teardown(data) {
  const expected = 30 * KEYS_PER_VU * AMOUNT;
  const response = http.get(`${BASE_URL}/accounts/${data.to}/balance`);
  const actual = Number(response.json('amount'));

  check(response, {
    'money moved once per key, not once per request': () => actual === expected,
  });

  if (actual !== expected) {
    console.error(`expected balance ${expected}, got ${actual}`);
  }

  assertLedgerBalanced();
}
