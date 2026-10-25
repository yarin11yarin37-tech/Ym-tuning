import type { Db } from '../db/database';
import { newId } from '../db/database';
import type { AuditLog } from './audit';
import type { Records } from './records';
import { Vault, sha256 } from './vault';
import { WorkshopError } from './errors';
import type {
  CalibrationRequest, CatalogOption, ControllerKind, Definition, DefinitionFile, DiffReport, MapData, ParsedRequest,
  Plan, ReviewPacket, Version, WriteGateResult, CheckResult,
} from '../../shared/workshop';
import { applyEdits, checkCompatibility, operationEdits, parseDefinition, readMap, type CellEdit } from '../calibration/definitions';
import { buildCatalog } from '../calibration/catalog';
import { diffFiles } from '../calibration/diff';
import { evaluateWriteGate, verifyVersion } from '../calibration/checks';
import { buildPlan } from '../calibration/request';
import { simulatedFile } from '../calibration/demoData';
import { FORMAT_EXT, parseControllerFile, writeControllerFile, type FormatMeta } from '../calibration/formats';
import { renderExportReport } from './report';
import type { ExportFormat, ImportOptions, OriginalFile, ToolExport } from '../../shared/workshop';
import { READ_METHODS, READ_TOOLS } from '../../shared/workshop';

/** Calibration workflows for ECU and TCU — always scoped to one controller kind at a time. */
export class Calibration {
  constructor(
    private readonly db: Db,
    private readonly vault: Vault,
    private readonly records: Records,
    private readonly audit: AuditLog,
  ) {}

  /* ---------- definitions ---------- */

  importDefinition(controllerId: string, text: string, source: 'imported' | 'simulated' = 'imported'): Definition {
    const ctl = this.records.getController(controllerId);
    if (!ctl) throw new WorkshopError('NOT_FOUND', 'controller');
    const def = parseDefinition(text);
    if (def.controller.kind !== ctl.kind) {
      this.audit.record('definition.import', 'blocked', 'controller', controllerId, { reason: 'kind mismatch' });
      throw new WorkshopError('INCOMPATIBLE', `definition is for ${def.controller.kind}, controller is ${ctl.kind}`);
    }
    const id = newId('def');
    this.db.run('INSERT INTO definitions (id, controller_id, kind, name, sha256, json, source, created_at) VALUES (?,?,?,?,?,?,?,?)', [
      id, controllerId, ctl.kind, def.name.slice(0, 120), sha256(Buffer.from(text)), JSON.stringify(def), source, new Date().toISOString(),
    ]);
    this.audit.record('definition.import', 'ok', 'definition', id, { controllerId, maps: def.maps.length, source });
    return this.getDefinition(id)!;
  }

  getDefinition(id: string): Definition | undefined {
    const r = this.db.get<any>('SELECT * FROM definitions WHERE id = ?', [id]);
    return r ? mapDef(r) : undefined;
  }

  /** Most recent definition for a controller. */
  definitionFor(controllerId: string): Definition | undefined {
    const r = this.db.get<any>('SELECT * FROM definitions WHERE controller_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [controllerId]);
    return r ? mapDef(r) : undefined;
  }

  /* ---------- demo ---------- */

  /** Create a fully SIMULATED vehicle with separate ECU and TCU, originals and definitions. */
  createDemoWorkspace() {
    const vehicle = this.records.saveVehicle({ make: 'רכב הדגמה', model: 'סימולציה', vin: 'YMTDEMV0000000001', vinProvenance: 'simulated' });
    const out: Record<ControllerKind, { controllerId: string; projectId: string }> = {} as any;
    for (const kind of ['ecu', 'tcu'] as const) {
      const { bytes, def } = simulatedFile(kind);
      const ctl = this.records.addController({
        vehicleId: vehicle.id, kind, label: kind === 'ecu' ? 'ECU הדגמה' : 'TCU הדגמה',
        hwId: def.controller.hwIds![0], swId: def.controller.swIds![0], idProvenance: 'simulated',
      });
      this.vault.storeOriginal({ controllerId: ctl.id, data: bytes, fileName: `${kind}-simulated.bin`, source: 'simulated' });
      this.importDefinition(ctl.id, JSON.stringify(def), 'simulated');
      const { project } = this.vault.createProject(ctl.id, kind === 'ecu' ? 'פרויקט הדגמה — ECU' : 'פרויקט הדגמה — TCU');
      out[kind] = { controllerId: ctl.id, projectId: project.id };
    }
    this.audit.record('demo.workspace', 'info', 'vehicle', vehicle.id);
    return { vehicleId: vehicle.id, ...out };
  }

  latestVersion(projectId: string): Version {
    const versions = this.vault.listVersions(projectId);
    if (!versions.length) throw new WorkshopError('NOT_FOUND', 'version');
    return versions[versions.length - 1];
  }

  /* ---------- maps & edits ---------- */

  private projectContext(projectId: string) {
    const project = this.vault.getProject(projectId);
    if (!project) throw new WorkshopError('NOT_FOUND', 'project');
    const controller = this.records.getController(project.controllerId)!;
    const original = this.vault.getOriginal(project.originalId)!;
    const definition = this.definitionFor(controller.id);
    return { project, controller, original, definition };
  }

  readMaps(projectId: string, versionId: string): { definition?: Definition; maps: MapData[] } {
    const { definition } = this.projectContext(projectId);
    const v = this.requireVersion(projectId, versionId);
    if (!definition) return { maps: [] };
    const buf = this.vault.readBlob(v.sha256);
    return { definition, maps: definition.file.maps.map((m) => readMap(buf, m)) };
  }

  private requireVersion(projectId: string, versionId: string): Version {
    const v = this.vault.getVersion(versionId);
    if (!v || v.projectId !== projectId) throw new WorkshopError('NOT_FOUND', 'version');
    return v;
  }

  /** Save manual cell edits as a new version, then run file checks on it. */
  editMap(projectId: string, versionId: string, mapId: string, edits: CellEdit[], note: string): Version {
    const ctx = this.projectContext(projectId);
    if (!ctx.definition) throw new WorkshopError('NOT_SUPPORTED', 'no definition for this controller');
    const map = ctx.definition.file.maps.find((m) => m.id === mapId);
    if (!map) throw new WorkshopError('NOT_FOUND', 'map');
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > 4096) throw new WorkshopError('INVALID_INPUT', 'edits');
    const parent = this.requireVersion(projectId, versionId);
    const next = applyEdits(this.vault.readBlob(parent.sha256), map, edits);
    const v = this.vault.addVersion(projectId, parent.id, next, 'manual-edit', note || `${map.name}: ${edits.length}`);
    this.runChecks(projectId, v.id);
    this.audit.record('map.edit', 'ok', 'version', v.id, { mapId, cells: edits.length, kind: ctx.project.kind });
    return this.vault.getVersion(v.id)!;
  }

  runChecks(projectId: string, versionId: string): CheckResult[] {
    const ctx = this.projectContext(projectId);
    const v = this.requireVersion(projectId, versionId);
    const integrity = this.vault.verifyOriginal(ctx.original.id);
    const checks = verifyVersion({
      original: ctx.original,
      originalBytes: this.vault.readBlob(ctx.original.sha256),
      integrity,
      versionBytes: this.vault.readBlob(v.sha256),
      versionSha: v.sha256,
      controller: ctx.controller,
      def: ctx.definition?.file,
    });
    this.vault.setVersionChecks(v.id, checks);
    this.audit.record('version.checks', checks.some((c) => c.status === 'fail') ? 'error' : 'ok', 'version', v.id, {
      fail: checks.filter((c) => c.status === 'fail').map((c) => c.id),
    });
    return checks;
  }

  diff(projectId: string, aVersionId: string | 'original', bVersionId: string): DiffReport {
    const ctx = this.projectContext(projectId);
    const aSha = aVersionId === 'original' ? ctx.original.sha256 : this.requireVersion(projectId, aVersionId).sha256;
    const b = this.requireVersion(projectId, bVersionId);
    return diffFiles(this.vault.readBlob(aSha), this.vault.readBlob(b.sha256), aSha, b.sha256, ctx.definition?.file);
  }

  catalog(controllerId: string): { options: CatalogOption[]; definition?: Definition } {
    const ctl = this.records.getController(controllerId);
    if (!ctl) throw new WorkshopError('NOT_FOUND', 'controller');
    const definition = this.definitionFor(controllerId);
    return { options: buildCatalog(ctl.kind, definition?.file), definition };
  }

  compatibility(controllerId: string) {
    const ctl = this.records.getController(controllerId);
    const def = this.definitionFor(controllerId);
    const org = this.vault.originalForController(controllerId);
    if (!ctl || !def || !org) return null;
    return checkCompatibility(def.file, ctl, org.size);
  }

  /* ---------- requests & plans ---------- */

  createRequest(input: { projectId?: string; kind: ControllerKind; text: string; parsed: ParsedRequest; engine: 'local' | 'ai' }): CalibrationRequest {
    let plan: Plan | undefined;
    if (input.projectId) {
      const ctx = this.projectContext(input.projectId);
      if (ctx.project.kind !== input.parsed.kind && input.parsed.intent !== 'compare') {
        throw new WorkshopError('INCOMPATIBLE', `request targets ${input.parsed.kind}, project is ${ctx.project.kind}`);
      }
      plan = buildPlan(input.parsed, ctx.definition?.file, ctx.definition?.source);
    } else {
      plan = buildPlan(input.parsed, undefined);
    }
    const status = plan.blocked.length ? 'rejected' : 'plan';
    const id = newId('req');
    const now = new Date().toISOString();
    this.db.run(
      'INSERT INTO requests (id, project_id, kind, text, parsed_json, plan_json, status, engine, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, input.projectId ?? null, input.parsed.kind, input.text.slice(0, 4000), JSON.stringify(input.parsed), JSON.stringify(plan), status, input.engine, now, now],
    );
    this.audit.record('request.create', status === 'rejected' ? 'blocked' : 'ok', 'request', id, {
      intent: input.parsed.intent, kind: input.parsed.kind, blocked: plan.blocked, engine: input.engine,
    });
    return this.getRequest(id)!;
  }

  getRequest(id: string): CalibrationRequest | undefined {
    const r = this.db.get<any>('SELECT * FROM requests WHERE id = ?', [id]);
    return r ? mapReq(r) : undefined;
  }

  listRequests(projectId?: string): CalibrationRequest[] {
    const rows = projectId
      ? this.db.all<any>('SELECT * FROM requests WHERE project_id = ? ORDER BY created_at DESC', [projectId])
      : this.db.all<any>('SELECT * FROM requests ORDER BY created_at DESC LIMIT 200');
    return rows.map(mapReq);
  }

  private setStatus(id: string, status: CalibrationRequest['status'], resultVersionId?: string) {
    this.db.run('UPDATE requests SET status = ?, result_version_id = COALESCE(?, result_version_id), updated_at = ? WHERE id = ?', [
      status, resultVersionId ?? null, new Date().toISOString(), id,
    ]);
  }

  /** User approval: required before anything is applied to the working copy. */
  approve(requestId: string): CalibrationRequest {
    const r = this.getRequest(requestId);
    if (!r) throw new WorkshopError('NOT_FOUND', 'request');
    if (r.status !== 'plan') throw new WorkshopError('INVALID_INPUT', `cannot approve from ${r.status}`);
    if (!r.plan?.items.some((i) => i.status === 'ready' && i.operation)) {
      this.audit.record('request.approve', 'blocked', 'request', requestId, { reason: 'nothing ready to apply' });
      throw new WorkshopError('NOT_SUPPORTED', 'plan has no items ready to apply');
    }
    this.setStatus(requestId, 'approved');
    this.audit.record('request.approve', 'ok', 'request', requestId);
    return this.getRequest(requestId)!;
  }

  /** Apply approved, ready operations to the latest working version → new version → checks. */
  applyApproved(requestId: string): { request: CalibrationRequest; version: Version } {
    const r = this.getRequest(requestId);
    if (!r || !r.projectId || !r.plan) throw new WorkshopError('NOT_FOUND', 'request');
    if (r.status !== 'approved') {
      this.audit.record('request.apply', 'blocked', 'request', requestId, { reason: 'not approved', status: r.status });
      throw new WorkshopError('INVALID_INPUT', 'request must be approved first');
    }
    const ctx = this.projectContext(r.projectId);
    if (!ctx.definition) throw new WorkshopError('NOT_SUPPORTED', 'no definition');
    const versions = this.vault.listVersions(r.projectId);
    const parent = versions[versions.length - 1];
    let buf: Uint8Array = this.vault.readBlob(parent.sha256);
    for (const item of r.plan.items) {
      if (item.status !== 'ready' || !item.operation || !item.mapId) continue;
      const map = ctx.definition.file.maps.find((m) => m.id === item.mapId)!;
      buf = applyEdits(buf, map, operationEdits(readMap(buf, map), item.operation));
    }
    const v = this.vault.addVersion(r.projectId, parent.id, buf, 'plan-applied', `request ${requestId}`);
    const checks = this.runChecks(r.projectId, v.id);
    const passed = !checks.some((c) => c.status === 'fail');
    this.setStatus(requestId, passed ? 'verified' : 'applied', v.id);
    this.audit.record('request.apply', 'ok', 'request', requestId, { versionId: v.id, checksPassed: passed });
    return { request: this.getRequest(requestId)!, version: this.vault.getVersion(v.id)! };
  }

  /* ---------- licensed-tool workflow ---------- */

  /**
   * Import a file exported by a licensed read tool (KESS, KTAG, Autotuner, …). The tool and read
   * method are stated by the user and stored as such. The file format is detected and its record
   * checksums verified; the raw image becomes the protected original.
   */
  importFromTool(controllerId: string, file: { name: string; data: Uint8Array }, opts: ImportOptions): OriginalFile {
    if (!READ_TOOLS.includes(opts?.tool) || !READ_METHODS.includes(opts?.readMethod)) throw new WorkshopError('INVALID_INPUT', 'tool / read method');
    const parsed = parseControllerFile(file.name, file.data);
    const original = this.vault.storeOriginal({
      controllerId,
      data: parsed.image,
      fileName: file.name,
      source: 'imported',
      sourceFile: file.data,
      meta: { fileFormat: parsed.meta, tool: opts.tool, readMethod: opts.readMethod, toolProvenance: 'user' },
    });
    this.audit.record('original.import', 'ok', 'original', original.id, { format: parsed.meta.format, tool: opts.tool, readMethod: opts.readMethod, size: parsed.image.length });
    return original;
  }

  /**
   * Build the file to hand back to the licensed tool for writing, in the original format.
   * YM TUNING does not correct controller checksums and does not write to the vehicle.
   */
  exportForTool(projectId: string, versionId: string, as: ExportFormat): { bytes: Uint8Array; info: ToolExport; report: string } {
    const ctx = this.projectContext(projectId);
    const version = this.requireVersion(projectId, versionId);
    const meta: FormatMeta = (ctx.original.meta.fileFormat as FormatMeta) ?? { format: 'raw', baseAddress: 0, ranges: [{ start: 0, end: ctx.original.size - 1 }] };
    const fmt = as === 'original' ? meta.format : as;
    if (!['raw', 'ihex', 'srec'].includes(fmt)) throw new WorkshopError('INVALID_INPUT', 'format');
    const image = this.vault.readBlob(version.sha256);
    const sourceSha = String(ctx.original.meta.sourceSha ?? ctx.original.sha256);
    const unchanged = version.sha256 === ctx.original.sha256 && fmt === meta.format;
    const bytes = unchanged ? this.vault.readBlob(sourceSha) : writeControllerFile(image, meta, fmt);
    // Round-trip check: the exported file must decode back to exactly this version's image.
    if (fmt !== 'raw') {
      const back = parseControllerFile('x', bytes);
      const covered = meta.ranges.every((r) => {
        const a = image.subarray(r.start - meta.baseAddress, r.end - meta.baseAddress + 1);
        const b = back.image.subarray(r.start - back.meta.baseAddress, r.end - back.meta.baseAddress + 1);
        return a.length === b.length && a.every((v, i) => v === b[i]);
      });
      if (!covered) throw new WorkshopError('INTEGRITY', 'export round-trip failed');
    }
    const base = ctx.original.fileName.replace(/\.[^.]+$/, '');
    const fileName = `${base}_${version.label}.${FORMAT_EXT[fmt]}`;
    const info: ToolExport = { fileName, sha256: sha256(bytes), size: bytes.length, format: fmt, identicalToSource: unchanged };
    const diff = this.diff(projectId, 'original', versionId);
    const report = renderExportReport({
      project: ctx.project.name, kind: ctx.project.kind, controller: ctx.controller, original: ctx.original,
      version, export: info, diff, definitionSource: ctx.definition?.source,
      tool: ctx.original.meta.tool as string | undefined, readMethod: ctx.original.meta.readMethod as string | undefined,
    });
    this.audit.record('version.export', 'ok', 'version', version.id, { format: fmt, sha256: info.sha256, identicalToSource: unchanged });
    return { bytes, info, report };
  }

  /* ---------- review & write gate ---------- */

  review(projectId: string, versionId: string, requestId?: string): ReviewPacket {
    const ctx = this.projectContext(projectId);
    this.requireVersion(projectId, versionId);
    const integrity = this.vault.verifyOriginal(ctx.original.id);
    const checks = this.runChecks(projectId, versionId);
    const diff = this.diff(projectId, 'original', versionId);
    const req = requestId ? this.getRequest(requestId) : undefined;
    const warnings: string[] = [];
    if (!ctx.definition) warnings.push('warn.noDefinition');
    else warnings.push(ctx.definition.source === 'simulated' ? 'warn.definitionSimulated' : 'warn.definitionUnverified');
    if (ctx.original.source !== 'read') warnings.push(ctx.original.source === 'simulated' ? 'warn.originalSimulated' : 'warn.originalImported');
    if (ctx.controller.idProvenance !== 'vehicle') warnings.push('warn.controllerIdNotRead');
    if (diff.unexplained.length) warnings.push('warn.unexplainedChanges');
    warnings.push('warn.checksumUnavailable', 'warn.noRestore');
    return {
      controller: ctx.controller,
      original: ctx.original,
      originalIntegrity: integrity,
      version: this.vault.getVersion(versionId)!,
      diff,
      definitionSource: ctx.definition?.source,
      plan: req?.plan,
      checks,
      warnings,
      restoreAvailable: false,
    };
  }

  writeGate(projectId: string, versionId: string, approved: boolean): WriteGateResult {
    const ctx = this.projectContext(projectId);
    this.requireVersion(projectId, versionId);
    const integrity = this.vault.verifyOriginal(ctx.original.id);
    const checks = this.runChecks(projectId, versionId);
    const gate = evaluateWriteGate({ controller: ctx.controller, integrity, checks, approved });
    this.audit.record(`${ctx.project.kind}.write`, 'blocked', 'version', versionId, {
      unmet: gate.requirements.filter((r) => !r.met).map((r) => r.id),
    });
    return gate;
  }
}

function mapDef(r: any): Definition {
  return { id: r.id, controllerId: r.controller_id, kind: r.kind, name: r.name, sha256: r.sha256, source: r.source, file: JSON.parse(r.json), createdAt: r.created_at };
}
function mapReq(r: any): CalibrationRequest {
  return {
    id: r.id, projectId: r.project_id ?? undefined, kind: r.kind, text: r.text, parsed: JSON.parse(r.parsed_json),
    plan: r.plan_json ? JSON.parse(r.plan_json) : undefined, status: r.status, resultVersionId: r.result_version_id ?? undefined,
    engine: r.engine, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export type { DefinitionFile };
