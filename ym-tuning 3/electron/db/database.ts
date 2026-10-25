/**
 * Local database — SQLite through Node's built-in `node:sqlite` (no native module to rebuild).
 * Requires an Electron version whose bundled Node exposes `node:sqlite` (Node ≥ 22.13).
 * All access goes through this wrapper; no SQL is ever built from renderer input.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

export type Row = Record<string, unknown>;
type Param = string | number | bigint | null | Uint8Array;

export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  }

  /** Apply pending migrations in order, each in its own transaction. Returns applied versions. */
  migrate(): number[] {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const done = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => Number(r.version)));
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
      });
      applied.push(m.version);
    }
    return applied;
  }

  schemaVersion(): number {
    const r = this.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
    return Number(r?.v ?? 0);
  }

  run(sql: string, params: Param[] = []) {
    return this.raw.prepare(sql).run(...params);
  }

  all<T = Row>(sql: string, params: Param[] = []): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, params: Param[] = []): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this.raw.close();
  }
}

export function newId(prefix: string): string {
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}
