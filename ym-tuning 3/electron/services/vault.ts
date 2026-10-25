/**
 * File vault — original backups and versioned working copies.
 *
 * Rules (enforced here AND by database triggers):
 *  - Blobs are content-addressed by SHA-256 and written with the exclusive 'wx' flag, so an
 *    existing file can never be overwritten. Original blobs are made read-only on disk.
 *  - An original is never updated or deleted by the app (DB triggers abort such statements).
 *  - Every edit creates a new version; versions are immutable.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/database';
import { newId } from '../db/database';
import type { AuditLog } from './audit';
import type { ControllerKind, FileSource, IntegrityReport, OriginalFile, Project, Version, CheckResult } from '../../shared/workshop';
import { WorkshopError } from './errors';

export const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MIN_FILE_BYTES = 1024;

export const sha256 = (buf: Uint8Array) => crypto.createHash('sha256').update(buf).digest('hex');

export class Vault {
  private readonly blobDir: string;

  constructor(
    private readonly db: Db,
    rootDir: string,
    private readonly audit: AuditLog,
  ) {
    this.blobDir = path.join(rootDir, 'blobs');
    fs.mkdirSync(this.blobDir, { recursive: true });
  }

  private blobPath(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new WorkshopError('INVALID_INPUT', 'bad hash');
    return path.join(this.blobDir, hash.slice(0, 2), hash);
  }

  /** Store bytes; returns the hash. Never overwrites; an existing blob must match byte-for-byte. */
  putBlob(buf: Uint8Array, readOnly: boolean): string {
    const hash = sha256(buf);
    const p = this.blobPath(hash);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p)) {
      if (sha256(fs.readFileSync(p)) !== hash) throw new WorkshopError('INTEGRITY', 'stored blob is corrupted');
    } else {
      fs.writeFileSync(p, buf, { flag: 'wx' });
    }
    if (readOnly) fs.chmodSync(p, 0o444);
    this.db.run('INSERT OR IGNORE INTO blobs (sha256, size, created_at) VALUES (?, ?, ?)', [hash, buf.length, new Date().toISOString()]);
    return hash;
  }

  readBlob(hash: string): Buffer {
    const p = this.blobPath(hash);
    if (!fs.existsSync(p)) throw new WorkshopError('NOT_FOUND', 'blob missing');
    const buf = fs.readFileSync(p);
    if (sha256(buf) !== hash) throw new WorkshopError('INTEGRITY', 'blob hash mismatch');
    return buf;
  }

  /**
   * Register the original file for a controller. One original per controller; a second call
   * is rejected (ORIGINAL_EXISTS) — the first original is never replaced.
   */
  storeOriginal(input: {
    controllerId: string;
    data: Uint8Array;
    fileName: string;
    source: FileSource;
    meta?: Record<string, unknown>;
    /** Exact bytes of the file as received (e.g. Intel HEX text), kept alongside the raw image. */
    sourceFile?: Uint8Array;
  }): OriginalFile {
    const ctl = this.db.get<any>('SELECT * FROM controllers WHERE id = ?', [input.controllerId]);
    if (!ctl) throw new WorkshopError('NOT_FOUND', 'controller');
    if (input.source === 'read') {
      // No verified hardware/protocol can read a controller yet.
      throw new WorkshopError('NOT_SUPPORTED', 'controller read is not implemented');
    }
    if (input.data.length < MIN_FILE_BYTES || input.data.length > MAX_FILE_BYTES) {
      throw new WorkshopError('INVALID_INPUT', 'file size out of range');
    }
    const existing = this.db.get<any>('SELECT id FROM originals WHERE controller_id = ?', [input.controllerId]);
    if (existing) {
      this.audit.record('original.store', 'blocked', 'controller', input.controllerId, { reason: 'ORIGINAL_EXISTS' });
      throw new WorkshopError('ORIGINAL_EXISTS', 'an original is already stored for this controller');
    }

    const hash = this.putBlob(input.data, true);
    const sourceSha = input.sourceFile ? this.putBlob(input.sourceFile, true) : hash;
    // Integrity: read back from disk and compare before registering.
    const back = this.readBlob(hash);
    if (back.length !== input.data.length) throw new WorkshopError('INTEGRITY', 'read-back size mismatch');

    const now = new Date().toISOString();
    const meta = {
      ...(input.meta ?? {}),
      sourceSha,
      controller: { kind: ctl.kind, hwId: ctl.hw_id ?? null, swId: ctl.sw_id ?? null, calId: ctl.cal_id ?? null },
    };
    const id = newId('org');
    this.db.run(
      'INSERT INTO originals (id, controller_id, kind, sha256, size, file_name, source, meta_json, created_at, verified_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, ctl.id, ctl.kind, hash, input.data.length, input.fileName.slice(0, 200), input.source, JSON.stringify(meta), now, now],
    );
    this.audit.record('original.store', 'ok', 'original', id, { sha256: hash, size: input.data.length, source: input.source, kind: ctl.kind });
    return this.getOriginal(id)!;
  }

  getOriginal(id: string): OriginalFile | undefined {
    const r = this.db.get<any>('SELECT * FROM originals WHERE id = ?', [id]);
    return r ? mapOriginal(r) : undefined;
  }

  originalForController(controllerId: string): OriginalFile | undefined {
    const r = this.db.get<any>('SELECT * FROM originals WHERE controller_id = ?', [controllerId]);
    return r ? mapOriginal(r) : undefined;
  }

  listOriginals(): OriginalFile[] {
    return this.db.all<any>('SELECT * FROM originals ORDER BY created_at DESC').map(mapOriginal);
  }

  /** Re-hash the stored original from disk. */
  verifyOriginal(id: string): IntegrityReport {
    const o = this.getOriginal(id);
    if (!o) throw new WorkshopError('NOT_FOUND', 'original');
    const now = new Date().toISOString();
    let actual: string | undefined;
    try {
      actual = sha256(fs.readFileSync(this.blobPath(o.sha256)));
    } catch {
      actual = undefined;
    }
    const ok = actual === o.sha256;
    if (ok) this.db.run('UPDATE originals SET verified_at = ? WHERE id = ?', [now, id]);
    this.audit.record('original.verify', ok ? 'ok' : 'error', 'original', id, { expected: o.sha256, actual: actual ?? 'missing' });
    return { originalId: id, sha256: o.sha256, ok, actual, checkedAt: now };
  }

  /** Create a project with its first working copy (a separate version, never the original row). */
  createProject(controllerId: string, name: string): { project: Project; version: Version } {
    const original = this.originalForController(controllerId);
    if (!original) throw new WorkshopError('NO_ORIGINAL', 'store and verify an original first');
    const integrity = this.verifyOriginal(original.id);
    if (!integrity.ok) throw new WorkshopError('INTEGRITY', 'original failed verification');
    const now = new Date().toISOString();
    const pid = newId('prj');
    return this.db.tx(() => {
      this.db.run('INSERT INTO projects (id, controller_id, kind, name, original_id, created_at) VALUES (?,?,?,?,?,?)', [
        pid, controllerId, original.kind, name.slice(0, 120), original.id, now,
      ]);
      const vid = newId('ver');
      this.db.run(
        'INSERT INTO versions (id, project_id, parent_id, seq, sha256, label, origin, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [vid, pid, null, 1, original.sha256, 'v1', 'working-copy', now],
      );
      this.audit.record('project.create', 'ok', 'project', pid, { controllerId, originalSha: original.sha256 });
      return { project: this.getProject(pid)!, version: this.getVersion(vid)! };
    });
  }

  getProject(id: string): Project | undefined {
    const r = this.db.get<any>('SELECT * FROM projects WHERE id = ?', [id]);
    return r ? mapProject(r) : undefined;
  }

  listProjects(kind?: ControllerKind): Project[] {
    const rows = kind
      ? this.db.all<any>('SELECT * FROM projects WHERE kind = ? ORDER BY created_at DESC', [kind])
      : this.db.all<any>('SELECT * FROM projects ORDER BY created_at DESC');
    return rows.map(mapProject);
  }

  /** Save edited bytes as a new immutable version. */
  addVersion(projectId: string, parentId: string, data: Uint8Array, origin: Version['origin'], note: string, checks: CheckResult[] = []): Version {
    const project = this.getProject(projectId);
    if (!project) throw new WorkshopError('NOT_FOUND', 'project');
    const parent = this.getVersion(parentId);
    if (!parent || parent.projectId !== projectId) throw new WorkshopError('INVALID_INPUT', 'parent version');
    const original = this.getOriginal(project.originalId)!;
    if (data.length !== original.size) throw new WorkshopError('INVALID_INPUT', 'size differs from original');
    const hash = this.putBlob(data, true);
    return this.db.tx(() => {
      const seq = Number(this.db.get<any>('SELECT MAX(seq) AS s FROM versions WHERE project_id = ?', [projectId])!.s) + 1;
      const id = newId('ver');
      this.db.run(
        'INSERT INTO versions (id, project_id, parent_id, seq, sha256, label, note, origin, checks_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, projectId, parentId, seq, hash, `v${seq}`, note.slice(0, 2000), origin, JSON.stringify(checks), new Date().toISOString()],
      );
      this.audit.record('version.create', 'ok', 'version', id, { projectId, seq, sha256: hash, origin });
      return this.getVersion(id)!;
    });
  }

  setVersionChecks(id: string, checks: CheckResult[]) {
    this.db.run('UPDATE versions SET checks_json = ? WHERE id = ?', [JSON.stringify(checks), id]);
  }

  getVersion(id: string): Version | undefined {
    const r = this.db.get<any>('SELECT * FROM versions WHERE id = ?', [id]);
    return r ? mapVersion(r) : undefined;
  }

  listVersions(projectId: string): Version[] {
    return this.db.all<any>('SELECT * FROM versions WHERE project_id = ? ORDER BY seq', [projectId]).map(mapVersion);
  }

  /** Copy a blob to a user-chosen path (export). Never targets the vault itself. */
  exportBlob(hash: string, target: string) {
    const resolved = path.resolve(target);
    if (resolved.startsWith(path.resolve(this.blobDir))) throw new WorkshopError('INVALID_INPUT', 'cannot export into the vault');
    fs.writeFileSync(resolved, this.readBlob(hash));
  }
}

function mapOriginal(r: any): OriginalFile {
  return {
    id: r.id, controllerId: r.controller_id, kind: r.kind, sha256: r.sha256, size: Number(r.size), fileName: r.file_name,
    source: r.source, createdAt: r.created_at, verifiedAt: r.verified_at ?? undefined, meta: JSON.parse(r.meta_json),
  };
}
function mapProject(r: any): Project {
  return { id: r.id, controllerId: r.controller_id, kind: r.kind, name: r.name, originalId: r.original_id, notes: r.notes ?? undefined, createdAt: r.created_at };
}
function mapVersion(r: any): Version {
  return {
    id: r.id, projectId: r.project_id, parentId: r.parent_id ?? undefined, seq: Number(r.seq), sha256: r.sha256, label: r.label,
    note: r.note ?? undefined, origin: r.origin, checks: JSON.parse(r.checks_json), createdAt: r.created_at,
  };
}
