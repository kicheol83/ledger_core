import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function loadTestEnv(): void {
  if (process.env['DATABASE_URL']) {
    return;
  }

  const envPath = resolve(repoRoot, '.env.test');

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);

    if (match && !line.trimStart().startsWith('#')) {
      const [, key, rawValue] = match;
      process.env[key!] ??= rawValue!.replace(/^["']|["']$/g, '');
    }
  }
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  let current = false;

  try {
    const files = readdirSync(resolve(repoRoot, 'db/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''));

    const applied = await client.query<{ name: string }>('SELECT name FROM pgmigrations');
    const names = new Set(applied.rows.map((row) => row.name));

    current = files.length > 0 && files.every((file) => names.has(file));
  } catch {
    current = false;
  } finally {
    await client.end();
  }

  if (current) {
    return;
  }

  execSync('pnpm migrate:test', { cwd: repoRoot, stdio: 'inherit' });
}

export default async function setup(): Promise<void> {
  loadTestEnv();

  const databaseUrl = process.env['DATABASE_URL'];

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Run tests via `pnpm test` from the repo root.');
  }

  if (!/_test(\?|$)/.test(databaseUrl)) {
    throw new Error(
      `Refusing to run tests against ${databaseUrl}: database name must end in _test`,
    );
  }

  await applyMigrations(databaseUrl);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const helpers = readFileSync(resolve(repoRoot, 'db/seeds/99-test-helpers.sql'), 'utf8');
    await client.query(helpers);
  } finally {
    await client.end();
  }
}
