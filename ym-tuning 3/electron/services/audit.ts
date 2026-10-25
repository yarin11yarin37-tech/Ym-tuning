import type { Db } from '../db/database';
import type { AuditEntry } from '../../shared/workshop';

export type Outcome = 'ok' | 'blocked' | 'error' | 'info';

/** Append-only action log. The table rejects UPDATE and DELETE at the database level. */
export class AuditLog {
  constructor(private readonly db: Db) {}

  record(action: string, outcome: Outcome, entity?: string, entityId?: string, detail: Record<string, unknown> = {}) {
    this.db.run('INSERT INTO audit (ts, action, entity, entity_id, outcome, detail_json) VALUES (?, ?, ?, ?, ?, ?)', [
      new Date().toISOString(),
      action,
      entity ?? null,
      entityId ?? null,
      outcome,
      JSON.stringify(detail).slice(0, 8000),
    ]);
  }

  list(limit = 200, entityId?: string): AuditEntry[] {
    const rows = entityId
      ? this.db.all<any>('SELECT * FROM audit WHERE entity_id = ? ORDER BY id DESC LIMIT ?', [entityId, limit])
      : this.db.all<any>('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [limit]);
    return rows.map((r) => ({
      id: Number(r.id),
      ts: r.ts,
      action: r.action,
      entity: r.entity ?? undefined,
      entityId: r.entity_id ?? undefined,
      outcome: r.outcome,
      detail: JSON.parse(r.detail_json),
    }));
  }
}
