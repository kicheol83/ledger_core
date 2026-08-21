import { afterAll, beforeEach } from 'vitest';
import { closePool, query } from './db.js';

beforeEach(async () => {
  await query('SELECT test_reset_ledger()');
});

afterAll(async () => {
  await closePool();
});
