import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function createPgDb(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  return {
    async query(sql, params) {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

export async function createMemoryDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  return {
    async query(sql, params) {
      const res = await db.query(sql, params as unknown[]);
      return res.rows as never[];
    },
    async exec(sql) {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

const MIGRATIONS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await db.exec(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
    await db.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    applied.push(f);
  }
  return applied;
}
