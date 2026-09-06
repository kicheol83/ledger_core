import { afterAll, beforeEach } from 'vitest';
import { closePool, query } from './db';

beforeEach(async () => {
  await query('SELECT test_reset_ledger()');
});

afterAll(async () => {
  await closePool();
});
