/**
 * In-browser workshop backend for the web demo (e.g. the Vercel deployment).
 *
 * Implements the same WorkshopApi as the desktop app, reusing the very same calibration logic
 * (definitions, diff, catalog, checks, write gate, request parser, plan builder, file formats,
 * reports). Storage is in memory only: everything disappears when the page is reloaded, and the
 * UI says so. There is no vehicle, adapter, network or file-system access from here.
 */
import type { ObdErrorInfo, Result } from '../../shared/types';
import type {
  AuditEntry, CalibrationRequest, CheckResult, Controller, ControllerKind, Customer, Definition, DiagSession,
  ExportFormat, ImportOptions, OriginalFile, Project, Vehicle, Version, WorkshopApi,
} from '../../shared/workshop';
import { READ_METHODS, READ_TOOLS } from '../../shared/workshop';
import { applyEdits, checkCompatibility, operationEdits, parseDefinition, readMap } from '../../electron/calibration/definitions';
import { buildCatalog } from '../../electron/calibration/catalog';
import { diffFiles } from '../../electron/calibration/diff';
import { evaluateWriteGate, verifyVersion } from '../../electron/calibration/checks';
import { buildPlan, parseRequest } from '../../electron/calibration/request';
import { composeReply } from '../../electron/calibration/reply';
import { simulatedFile } from '../../electron/calibration/demoData';
import { FORMAT_EXT, parseControllerFile, writeControllerFile, type FormatMeta } from '../../electron/calibration/formats';
import { PROTOCOL_ROADMAP } from '../../electron/hardware/hal';
import { renderExportReport, renderReport } from '../../electron/services/report';
import { WorkshopError } from '../../electron/services/errors';

export interface WebFiles {
  /** Ask the user for a file (must be called synchronously inside a click). */
  openFile(kind: 'binary' | 'definition'): Promise<{ name: string; data: Uint8Array } | null>;
  /** Hand a file to the user (browser download). */
  download(name: string, data: Uint8Array | string, mime: string): void;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const MAX_FILE = 32 * 1024 * 1024;

export async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(prefix: string) {
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

const now = () => new Date().toISOString();
const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

async function wrap<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const err = e as { name?: string; code?: string; detail?: string; message?: string };
    const info: ObdErrorInfo = err?.name === 'WorkshopError'
      ? { code: err.code as ObdErrorInfo['code'], detail: err.detail }
      : { code: 'INTERNAL', detail: String(err?.message ?? e).slice(0, 200) };
    return { ok: false, error: info };
  }
}

export function createWebWorkshop(files: WebFiles): WorkshopApi {
  const customers: Customer[] = [];
  const vehicles: Vehicle[] = [];
  const controllers: Controller[] = [];
  const blobs = new Map<string, Uint8Array>();
  const originals: OriginalFile[] = [];
  const projects: Project[] = [];
  const versions: Version[] = [];
  const definitions: Definition[] = [];
  const requests: CalibrationRequest[] = [];
  const sessions: DiagSession[] = [];
  const audit: AuditEntry[] = [];
  let auditId = 0;

  const log = (action: string, outcome: AuditEntry['outcome'], entity?: string, entityId?: string, detail: Record<string, unknown> = {}) =>
    audit.push({ id: ++auditId, ts: now(), action, entity, entityId, outcome, detail });

  /** Blobs are immutable: a hash is written once and never replaced. */
  const putBlob = async (data: Uint8Array) => {
    const h = await sha256(data);
    if (!blobs.has(h)) blobs.set(h, data.slice());
    return h;
  };
  const readBlob = async (h: string) => {
    const b = blobs.get(h);
    if (!b) throw new WorkshopError('NOT_FOUND', 'blob');
    if ((await sha256(b)) !== h) throw new WorkshopError('INTEGRITY', 'blob hash mismatch');
    return b.slice();
  };

  const ctlOf = (id: string) => controllers.find((c) => c.id === id) ?? fail('NOT_FOUND', 'controller');
  const defFor = (cid: string) => [...definitions].reverse().find((d) => d.controllerId === cid);
  const projectCtx = (pid: string) => {
    const project = projects.find((p) => p.id === pid) ?? fail('NOT_FOUND', 'project');
    const controller = ctlOf(project.controllerId);
    const original = originals.find((o) => o.id === project.originalId)!;
    return { project, controller, original, definition: defFor(controller.id) };
  };
  const versionOf = (pid: string, vid: string) => versions.find((v) => v.id === vid && v.projectId === pid) ?? fail('NOT_FOUND', 'version');
  const latest = (pid: string) => versions.filter((v) => v.projectId === pid).sort((a, b) => a.seq - b.seq).at(-1)!;

  function fail(code: ConstructorParameters<typeof WorkshopError>[0], detail?: string): never {
    throw new WorkshopError(code, detail);
  }

  const verifyOriginal = async (oid: string) => {
    const o = originals.find((x) => x.id === oid) ?? fail('NOT_FOUND', 'original');
    const b = blobs.get(o.sha256);
    const actual = b ? await sha256(b) : undefined;
    const ok = actual === o.sha256;
    if (ok) o.verifiedAt = now();
    log('original.verify', ok ? 'ok' : 'error', 'original', oid);
    return { originalId: oid, sha256: o.sha256, ok, actual, checkedAt: now() };
  };

  const storeOriginal = async (cid: string, image: Uint8Array, fileName: string, source: 'imported' | 'simulated', meta: Record<string, unknown>, sourceFile?: Uint8Array) => {
    const ctl = ctlOf(cid);
    if (image.length < 1024 || image.length > MAX_FILE) fail('INVALID_INPUT', 'file size out of range');
    if (originals.some((o) => o.controllerId === cid)) {
      log('original.store', 'blocked', 'controller', cid, { reason: 'ORIGINAL_EXISTS' });
      fail('ORIGINAL_EXISTS');
    }
    const h = await putBlob(image);
    const sourceSha = sourceFile ? await putBlob(sourceFile) : h;
    const row: OriginalFile = {
      id: newId('org'), controllerId: cid, kind: ctl.kind, sha256: h, size: image.length, fileName: fileName.slice(0, 200), source,
      createdAt: now(), verifiedAt: now(),
      meta: { ...meta, sourceSha, controller: { kind: ctl.kind, hwId: ctl.hwId ?? null, swId: ctl.swId ?? null } },
    };
    originals.push(row);
    log('original.store', 'ok', 'original', row.id, { sha256: h, source, kind: ctl.kind });
    return row;
  };

  const addVersion = async (pid: string, parentId: string, data: Uint8Array, origin: Version['origin'], note: string) => {
    const { original } = projectCtx(pid);
    if (data.length !== original.size) fail('INVALID_INPUT', 'size differs from original');
    const h = await putBlob(data);
    const seq = latest(pid).seq + 1;
    const v: Version = { id: newId('ver'), projectId: pid, parentId, seq, sha256: h, label: `v${seq}`, note: note.slice(0, 2000), origin, checks: [], createdAt: now() };
    versions.push(v);
    log('version.create', 'ok', 'version', v.id, { seq, origin });
    return v;
  };

  const runChecks = async (pid: string, vid: string): Promise<CheckResult[]> => {
    const ctx = projectCtx(pid);
    const v = versionOf(pid, vid);
    const integrity = await verifyOriginal(ctx.original.id);
    const checks = verifyVersion({
      original: ctx.original, originalBytes: await readBlob(ctx.original.sha256), integrity,
      versionBytes: await readBlob(v.sha256), versionSha: v.sha256, controller: ctx.controller, def: ctx.definition?.file,
    });
    v.checks = checks;
    log('version.checks', checks.some((c) => c.status === 'fail') ? 'error' : 'ok', 'version', vid);
    return checks;
  };

  const diff = async (pid: string, a: string, b: string) => {
    const ctx = projectCtx(pid);
    const aSha = a === 'original' ? ctx.original.sha256 : versionOf(pid, a).sha256;
    const vb = versionOf(pid, b);
    return diffFiles(await readBlob(aSha), await readBlob(vb.sha256), aSha, vb.sha256, ctx.definition?.file);
  };

  const importDefinition = (cid: string, text: string, source: 'imported' | 'simulated') => {
    const ctl = ctlOf(cid);
    const def = parseDefinition(text);
    if (def.controller.kind !== ctl.kind) {
      log('definition.import', 'blocked', 'controller', cid, { reason: 'kind mismatch' });
      fail('INCOMPATIBLE', 'definition kind');
    }
    const d: Definition = { id: newId('def'), controllerId: cid, kind: ctl.kind, name: def.name.slice(0, 120), sha256: '', source, file: def, createdAt: now() };
    definitions.push(d);
    log('definition.import', 'ok', 'definition', d.id, { maps: def.maps.length, source });
    return d;
  };

  const createProject = async (cid: string, name: string) => {
    const original = originals.find((o) => o.controllerId === cid) ?? fail('NO_ORIGINAL');
    if (!(await verifyOriginal(original.id)).ok) fail('INTEGRITY');
    const project: Project = { id: newId('prj'), controllerId: cid, kind: original.kind, name: name.slice(0, 120), originalId: original.id, createdAt: now() };
    projects.push(project);
    const version: Version = { id: newId('ver'), projectId: project.id, seq: 1, sha256: original.sha256, label: 'v1', origin: 'working-copy', checks: [], createdAt: now() };
    versions.push(version);
    log('project.create', 'ok', 'project', project.id);
    return { project, version };
  };

  const createRequest = (pid: string | undefined, text: string, kind: ControllerKind) => {
    const parsed = parseRequest(text, kind);
    let plan;
    if (pid) {
      const ctx = projectCtx(pid);
      if (ctx.project.kind !== parsed.kind && parsed.intent !== 'compare') fail('INCOMPATIBLE', 'request kind');
      plan = buildPlan(parsed, ctx.definition?.file, ctx.definition?.source);
    } else plan = buildPlan(parsed, undefined);
    const r: CalibrationRequest = {
      id: newId('req'), projectId: pid, kind: parsed.kind, text: text.slice(0, 4000), parsed, plan,
      status: plan.blocked.length ? 'rejected' : 'plan', engine: 'local', createdAt: now(), updatedAt: now(),
    };
    requests.unshift(r);
    log('request.create', r.status === 'rejected' ? 'blocked' : 'ok', 'request', r.id, { intent: parsed.intent });
    return r;
  };

  const api: WorkshopApi = {
    wsInfo: () => wrap(() => ({ schemaVersion: 1 })),

    listCustomers: () => wrap(() => [...customers]),
    saveCustomer: (c) => wrap(() => {
      const name = clean(c.name, 120) ?? fail('INVALID_INPUT', 'name');
      const existing = customers.find((x) => x.id === c.id);
      const row: Customer = { id: existing?.id ?? newId('cus'), name, phone: clean(c.phone, 40), email: clean(c.email, 120), notes: clean(c.notes, 2000), createdAt: existing?.createdAt ?? now() };
      if (existing) Object.assign(existing, row); else customers.push(row);
      log(existing ? 'customer.update' : 'customer.create', 'ok', 'customer', row.id);
      return row;
    }),
    listVehicles: () => wrap(() => [...vehicles].reverse()),
    saveVehicle: (v) => wrap(() => {
      const vin = clean(v.vin, 17)?.toUpperCase();
      if (vin && !VIN_RE.test(vin)) fail('INVALID_INPUT', 'VIN');
      // No vehicle can be read in the browser, so a 'vehicle' provenance claim is never accepted here.
      const vinProvenance = vin ? (v.vinProvenance === 'simulated' ? 'simulated' : 'user') : undefined;
      const existing = vehicles.find((x) => x.id === v.id);
      const row: Vehicle = {
        id: existing?.id ?? newId('veh'), customerId: v.customerId, vin, vinProvenance, make: clean(v.make, 60), model: clean(v.model, 60),
        year: v.year, engine: clean(v.engine, 80), gearbox: clean(v.gearbox, 80), plate: clean(v.plate, 20), notes: clean(v.notes, 2000),
        createdAt: existing?.createdAt ?? now(),
      };
      if (existing) Object.assign(existing, row); else vehicles.push(row);
      log(existing ? 'vehicle.update' : 'vehicle.create', 'ok', 'vehicle', row.id);
      return row;
    }),
    listControllers: (kind) => wrap(() => controllers.filter((c) => !kind || c.kind === kind).reverse()),
    addController: (c) => wrap(() => {
      if (c.kind !== 'ecu' && c.kind !== 'tcu') fail('INVALID_INPUT', 'kind');
      if (!vehicles.some((v) => v.id === c.vehicleId)) fail('NOT_FOUND', 'vehicle');
      const row: Controller = {
        id: newId(c.kind), vehicleId: c.vehicleId, kind: c.kind, label: clean(c.label, 80), hwId: clean(c.hwId, 60), swId: clean(c.swId, 60),
        calId: clean(c.calId, 60), idProvenance: (c as { idProvenance?: string }).idProvenance === 'simulated' ? 'simulated' : 'user', createdAt: now(),
      };
      controllers.push(row);
      log('controller.create', 'ok', 'controller', row.id, { kind: row.kind });
      return row;
    }),

    listOriginals: () => wrap(() => [...originals].reverse()),
    importOriginal: (cid, opts: ImportOptions) => {
      // openFile must start synchronously inside the user's click.
      const picked = files.openFile('binary');
      return wrap(async () => {
        if (!READ_TOOLS.includes(opts?.tool) || !READ_METHODS.includes(opts?.readMethod)) fail('INVALID_INPUT', 'tool');
        const f = await picked;
        if (!f) fail('CANCELLED');
        if (f.data.length > MAX_FILE) fail('INVALID_INPUT', 'file too large');
        const parsed = parseControllerFile(f.name, f.data);
        const o = await storeOriginal(cid, parsed.image, f.name, 'imported', { fileFormat: parsed.meta, tool: opts.tool, readMethod: opts.readMethod, toolProvenance: 'user' }, f.data);
        log('original.import', 'ok', 'original', o.id, { format: parsed.meta.format, tool: opts.tool });
        return o;
      });
    },
    verifyOriginal: (oid) => wrap(() => verifyOriginal(oid)),
    exportOriginal: (oid) => wrap(async () => {
      const o = originals.find((x) => x.id === oid) ?? fail('NOT_FOUND', 'original');
      files.download(o.fileName, await readBlob(String(o.meta.sourceSha ?? o.sha256)), 'application/octet-stream');
      log('original.export', 'ok', 'original', oid);
      return true as const;
    }),
    exportVersion: (pid, vid, as: ExportFormat) => wrap(async () => {
      const ctx = projectCtx(pid);
      const version = versionOf(pid, vid);
      const meta: FormatMeta = (ctx.original.meta.fileFormat as FormatMeta) ?? { format: 'raw', baseAddress: 0, ranges: [{ start: 0, end: ctx.original.size - 1 }] };
      const fmt = as === 'original' ? meta.format : as;
      if (!['raw', 'ihex', 'srec'].includes(fmt)) fail('INVALID_INPUT', 'format');
      const unchanged = version.sha256 === ctx.original.sha256 && fmt === meta.format;
      const bytes = unchanged ? await readBlob(String(ctx.original.meta.sourceSha ?? ctx.original.sha256)) : writeControllerFile(await readBlob(version.sha256), meta, fmt);
      const fileName = `${ctx.original.fileName.replace(/\.[^.]+$/, '')}_${version.label}.${FORMAT_EXT[fmt]}`;
      const info = { fileName, sha256: await sha256(bytes), size: bytes.length, format: fmt, identicalToSource: unchanged };
      const report = renderExportReport({
        project: ctx.project.name, kind: ctx.project.kind, controller: ctx.controller, original: ctx.original, version, export: info,
        diff: await diff(pid, 'original', vid), definitionSource: ctx.definition?.source,
        tool: ctx.original.meta.tool as string | undefined, readMethod: ctx.original.meta.readMethod as string | undefined,
      });
      files.download(fileName, bytes, 'application/octet-stream');
      files.download(`${fileName}.ym-report.html`, report, 'text/html');
      log('version.export', 'ok', 'version', vid, { format: fmt });
      return info;
    }),

    listProjects: (kind) => wrap(() => projects.filter((p) => !kind || p.kind === kind).reverse()),
    createProject: (cid, name) => wrap(() => (String(name ?? '').trim() ? createProject(cid, String(name)) : fail('INVALID_INPUT', 'name'))),
    listVersions: (pid) => wrap(() => versions.filter((v) => v.projectId === pid).sort((a, b) => a.seq - b.seq)),

    importDefinition: (cid) => {
      const picked = files.openFile('definition');
      return wrap(async () => {
        const f = await picked;
        if (!f) fail('CANCELLED');
        return importDefinition(cid, new TextDecoder().decode(f.data), 'imported');
      });
    },
    getDefinition: (cid) => wrap(() => defFor(cid) ?? null),

    readMaps: (pid, vid) => wrap(async () => {
      const { definition } = projectCtx(pid);
      const v = versionOf(pid, vid);
      if (!definition) return { maps: [] };
      const buf = await readBlob(v.sha256);
      return { definition, maps: definition.file.maps.map((m) => readMap(buf, m)) };
    }),
    editMap: (pid, vid, mapId, edits, note) => wrap(async () => {
      const ctx = projectCtx(pid);
      const map = ctx.definition?.file.maps.find((m) => m.id === mapId) ?? fail('NOT_FOUND', 'map');
      if (!Array.isArray(edits) || !edits.length) fail('INVALID_INPUT', 'edits');
      const parent = versionOf(pid, vid);
      const v = await addVersion(pid, parent.id, applyEdits(await readBlob(parent.sha256), map, edits), 'manual-edit', note || `${map.name}: ${edits.length}`);
      await runChecks(pid, v.id);
      log('map.edit', 'ok', 'version', v.id, { mapId });
      return v;
    }),
    runChecks: (pid, vid) => wrap(() => runChecks(pid, vid)),
    diff: (pid, a, b) => wrap(() => diff(pid, a, b)),
    catalog: (cid) => wrap(() => ({ options: buildCatalog(ctlOf(cid).kind, defFor(cid)?.file), definition: defFor(cid) })),
    compatibility: (cid) => wrap(() => {
      const ctl = ctlOf(cid), def = defFor(cid), org = originals.find((o) => o.controllerId === cid);
      return def && org ? checkCompatibility(def.file, ctl, org.size) : null;
    }),
    review: (pid, vid, rid) => wrap(async () => {
      const ctx = projectCtx(pid);
      const integrity = await verifyOriginal(ctx.original.id);
      const checks = await runChecks(pid, vid);
      const d = await diff(pid, 'original', vid);
      const warnings: string[] = [];
      if (!ctx.definition) warnings.push('warn.noDefinition');
      else warnings.push(ctx.definition.source === 'simulated' ? 'warn.definitionSimulated' : 'warn.definitionUnverified');
      warnings.push(ctx.original.source === 'simulated' ? 'warn.originalSimulated' : 'warn.originalImported');
      if (ctx.controller.idProvenance !== 'vehicle') warnings.push('warn.controllerIdNotRead');
      if (d.unexplained.length) warnings.push('warn.unexplainedChanges');
      warnings.push('warn.checksumUnavailable', 'warn.noRestore');
      return {
        controller: ctx.controller, original: ctx.original, originalIntegrity: integrity, version: versionOf(pid, vid), diff: d,
        definitionSource: ctx.definition?.source, plan: rid ? requests.find((r) => r.id === rid)?.plan : undefined,
        checks, warnings, restoreAvailable: false,
      };
    }),
    readinessCheck: (pid, vid, approved) => wrap(async () => {
      const ctx = projectCtx(pid);
      const integrity = await verifyOriginal(ctx.original.id);
      const gate = evaluateWriteGate({ controller: ctx.controller, integrity, checks: await runChecks(pid, vid), approved: approved === true });
      log(`${ctx.project.kind}.write`, 'blocked', 'version', vid);
      return gate;
    }),

    listRequests: (pid) => wrap(() => requests.filter((r) => !pid || r.projectId === pid)),
    approveRequest: (rid) => wrap(() => {
      const r = requests.find((x) => x.id === rid) ?? fail('NOT_FOUND', 'request');
      if (r.status !== 'plan') fail('INVALID_INPUT', 'status');
      if (!r.plan?.items.some((i) => i.status === 'ready' && i.operation)) fail('NOT_SUPPORTED', 'nothing ready');
      r.status = 'approved';
      r.updatedAt = now();
      log('request.approve', 'ok', 'request', rid);
      return { ...r };
    }),
    applyRequest: (rid) => wrap(async () => {
      const r = requests.find((x) => x.id === rid) ?? fail('NOT_FOUND', 'request');
      if (r.status !== 'approved' || !r.projectId || !r.plan) fail('INVALID_INPUT', 'must be approved');
      const ctx = projectCtx(r.projectId);
      const def = ctx.definition ?? fail('NOT_SUPPORTED', 'no definition');
      const parent = latest(r.projectId);
      let buf = await readBlob(parent.sha256);
      for (const item of r.plan.items) {
        if (item.status !== 'ready' || !item.operation || !item.mapId) continue;
        const map = def.file.maps.find((m) => m.id === item.mapId)!;
        buf = applyEdits(buf, map, operationEdits(readMap(buf, map), item.operation));
      }
      const v = await addVersion(r.projectId, parent.id, buf, 'plan-applied', `request ${rid}`);
      const checks = await runChecks(r.projectId, v.id);
      r.status = checks.some((c) => c.status === 'fail') ? 'applied' : 'verified';
      r.resultVersionId = v.id;
      r.updatedAt = now();
      log('request.apply', 'ok', 'request', rid);
      return { request: { ...r }, version: v };
    }),

    assistantStatus: () => wrap(() => ({ aiConfigured: false, engine: 'local' as const })),
    assistantAsk: (input) => wrap(async () => {
      const text = String(input?.text ?? '').trim();
      if (!text) fail('INVALID_INPUT', 'empty');
      const request = createRequest(input.projectId, text, input.kind);
      let compare;
      if (request.parsed.intent === 'compare' && input.projectId && !request.plan!.blocked.length) {
        const last = latest(input.projectId);
        compare = { diff: await diff(input.projectId, 'original', last.id), versionLabel: last.label };
      }
      const lines = composeReply({ parsed: request.parsed, request, engine: 'local', hasProject: !!input.projectId, compare });
      log('assistant.message', 'info', 'request', request.id);
      return { request, lines };
    }),
    assistantConfigure: () => wrap(() => fail('NOT_SUPPORTED', 'AI is available in the desktop app')),

    createDemoWorkspace: () => wrap(async () => {
      const vehicle = await api.saveVehicle({ make: 'רכב הדגמה', model: 'סימולציה', vin: 'YMTDEMV0000000001', vinProvenance: 'simulated' });
      if (!vehicle.ok) throw new Error('demo vehicle');
      const out: Record<ControllerKind, { controllerId: string; projectId: string }> = {} as never;
      for (const kind of ['ecu', 'tcu'] as const) {
        const { bytes, def } = simulatedFile(kind);
        const ctl: Controller = {
          id: newId(kind), vehicleId: vehicle.data.id, kind, label: kind === 'ecu' ? 'ECU הדגמה' : 'TCU הדגמה',
          hwId: def.controller.hwIds![0], swId: def.controller.swIds![0], idProvenance: 'simulated', createdAt: now(),
        };
        controllers.push(ctl);
        await storeOriginal(ctl.id, bytes, `${kind}-simulated.bin`, 'simulated', {});
        importDefinition(ctl.id, JSON.stringify(def), 'simulated');
        const { project } = await createProject(ctl.id, kind === 'ecu' ? 'פרויקט הדגמה — ECU' : 'פרויקט הדגמה — TCU');
        out[kind] = { controllerId: ctl.id, projectId: project.id };
      }
      log('demo.workspace', 'info', 'vehicle', vehicle.data.id);
      return { vehicleId: vehicle.data.id, ...out };
    }),

    listSessions: () => wrap(() => [...sessions]),
    saveSession: (s) => wrap(() => {
      const row: DiagSession = { id: newId('ses'), vehicleId: s.vehicleId, mode: s.mode === 'live' ? 'live' : 'demo', title: String(s.title ?? '').slice(0, 120), data: s.data, createdAt: now() };
      sessions.unshift(row);
      log('diag.session.save', 'ok', 'session', row.id);
      return row;
    }),
    exportReport: (sid) => wrap(() => {
      const s = sessions.find((x) => x.id === sid) ?? fail('NOT_FOUND', 'session');
      files.download(`ym-report-${s.createdAt.slice(0, 10)}.html`, renderReport({ title: s.title, mode: s.mode, createdAt: s.createdAt, data: s.data as never }), 'text/html');
      log('diag.report.export', 'ok', 'session', sid);
      return true as const;
    }),

    auditList: (limit) => wrap(() => [...audit].reverse().slice(0, limit ?? 200)),
    usbScan: () => wrap(() => ({ supported: false, devices: [], reasonKey: 'usb.reason.web' })),
    protocolRoadmap: () => wrap(() => PROTOCOL_ROADMAP),
    defaultRoute: () => wrap(() => ({ known: false })),
    internetCheck: () => wrap(() => ({ online: typeof navigator !== 'undefined' ? navigator.onLine : true, checkedAt: now() })),
  };
  return api;
}
