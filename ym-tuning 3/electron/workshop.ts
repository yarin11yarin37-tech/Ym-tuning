import path from 'node:path';
import fs from 'node:fs';
import { Db } from './db/database';
import { AuditLog } from './services/audit';
import { Vault } from './services/vault';
import { Records } from './services/records';
import { Calibration } from './services/calibration';
import { Assistant, type SecretStore } from './services/assistant';

/** Composition root for all workshop services. One instance per app (or per test). */
export class Workshop {
  readonly db: Db;
  readonly audit: AuditLog;
  readonly vault: Vault;
  readonly records: Records;
  readonly calibration: Calibration;
  readonly assistant: Assistant;

  constructor(dataDir: string, secret: SecretStore, fetchImpl?: typeof fetch) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Db(path.join(dataDir, 'ym-tuning.sqlite'));
    this.db.migrate();
    this.audit = new AuditLog(this.db);
    this.vault = new Vault(this.db, path.join(dataDir, 'vault'), this.audit);
    this.records = new Records(this.db, this.audit);
    this.calibration = new Calibration(this.db, this.vault, this.records, this.audit);
    this.assistant = new Assistant(this.calibration, this.audit, secret, undefined, fetchImpl);
    this.audit.record('app.start', 'info', undefined, undefined, { schema: this.db.schemaVersion() });
  }

  close() {
    this.db.close();
  }
}

export function memorySecret(): SecretStore {
  let v: string | null = null;
  return { get: () => v, set: (x) => { v = x; } };
}
