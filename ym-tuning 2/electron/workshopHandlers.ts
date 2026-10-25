/**
 * IPC handlers for the workshop (records, vault, calibration, assistant, hardware, network).
 * Every argument is validated here. File paths NEVER come from the renderer: opening and saving
 * files always goes through native dialogs owned by the main process (`Dialogs`).
 * There is no channel that writes to a vehicle controller.
 */
import fs from 'node:fs';
import type { Result } from '../shared/types';
import type { ControllerKind } from '../shared/workshop';
import { Workshop } from './workshop';
import { toErrorInfo } from './obd/errors';
import { scanUsb } from './hardware/usb';
import { PROTOCOL_ROADMAP } from './hardware/hal';
import { checkInternet, defaultRoute } from './network/internet';
import { renderReport } from './services/report';
import { MAX_FILE_BYTES } from './services/vault';
import { WorkshopError } from './services/errors';

export interface Dialogs {
  /** Ask the user for a file; returns its name and bytes, or null if cancelled. */
  openFile(kind: 'binary' | 'definition'): Promise<{ name: string; data: Buffer } | null>;
  /** Ask the user where to save; returns the chosen path or null. */
  saveFile(defaultName: string, kind: 'binary' | 'report'): Promise<string | null>;
}

export const WORKSHOP_CHANNELS = [
  'ws:info',
  'customers:list', 'customers:save',
  'vehicles:list', 'vehicles:save',
  'controllers:list', 'controllers:add',
  'vault:originals', 'vault:importOriginal', 'vault:verify', 'vault:exportOriginal', 'vault:exportVersion',
  'projects:list', 'projects:create', 'projects:versions',
  'defs:import', 'defs:get',
  'cal:maps', 'cal:edit', 'cal:checks', 'cal:diff', 'cal:catalog', 'cal:compat', 'cal:review', 'cal:readiness',
  'req:list', 'req:approve', 'req:apply',
  'asst:status', 'asst:ask', 'asst:configure',
  'demo:workspace',
  'sessions:list', 'sessions:save', 'sessions:exportReport',
  'audit:list',
  'hw:usb', 'hw:roadmap',
  'net:route', 'net:internet',
] as const;
export type WorkshopChannel = (typeof WORKSHOP_CHANNELS)[number];

type Handler = (...args: unknown[]) => Promise<Result<unknown>>;

const ID = /^(cus|veh|ecu|tcu|org|prj|ver|def|req|ses)_[a-z0-9]{6,40}$/;
const id = (v: unknown, prefix?: string): string => {
  if (typeof v !== 'string' || !ID.test(v) || (prefix && !v.startsWith(`${prefix}_`))) throw new WorkshopError('INVALID_INPUT', 'id');
  return v;
};
const kindOf = (v: unknown): ControllerKind => {
  if (v !== 'ecu' && v !== 'tcu') throw new WorkshopError('INVALID_INPUT', 'kind');
  return v;
};
const obj = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new WorkshopError('INVALID_INPUT', 'object');
  return v as Record<string, any>;
};

async function wrap<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toErrorInfo(e) };
  }
}

export function createWorkshopHandlers(ws: Workshop, dialogs: Dialogs, vehicleVin: () => string | null = () => null): Record<WorkshopChannel, Handler> {
  const { records, vault, calibration, assistant, audit } = ws;
  return {
    'ws:info': () => wrap(() => ({ schemaVersion: ws.db.schemaVersion() })),

    'customers:list': () => wrap(() => records.listCustomers()),
    'customers:save': (c) => wrap(() => records.saveCustomer(obj(c) as any)),
    'vehicles:list': () => wrap(() => records.listVehicles()),
    'vehicles:save': (v) =>
      wrap(() => {
        const o = obj(v);
        // 'vehicle' provenance is accepted only if this VIN was actually read in the current session.
        if (o.vinProvenance === 'vehicle' && (!o.vin || o.vin !== vehicleVin())) o.vinProvenance = 'user';
        if (o.vinProvenance !== 'vehicle' && o.vinProvenance !== 'simulated') o.vinProvenance = 'user';
        return records.saveVehicle(o);
      }),
    'controllers:list': (k) => wrap(() => records.listControllers(k === undefined ? undefined : kindOf(k))),
    'controllers:add': (c) =>
      wrap(() => {
        const o = obj(c);
        // Identities typed by the user are 'user'; 'vehicle' can only come from a verified read.
        const prov = o.idProvenance === 'simulated' ? 'simulated' : 'user';
        return records.addController({ vehicleId: id(o.vehicleId, 'veh'), kind: kindOf(o.kind), label: o.label, hwId: o.hwId, swId: o.swId, calId: o.calId, idProvenance: prov });
      }),

    'vault:originals': () => wrap(() => vault.listOriginals()),
    'vault:importOriginal': (controllerId) =>
      wrap(async () => {
        const cid = id(controllerId);
        const f = await dialogs.openFile('binary');
        if (!f) throw new WorkshopError('CANCELLED');
        return vault.storeOriginal({ controllerId: cid, data: f.data, fileName: f.name, source: 'imported', meta: { importedName: f.name } });
      }),
    'vault:verify': (oid) => wrap(() => vault.verifyOriginal(id(oid, 'org'))),
    'vault:exportOriginal': (oid) =>
      wrap(async () => {
        const o = vault.getOriginal(id(oid, 'org'));
        if (!o) throw new WorkshopError('NOT_FOUND', 'original');
        const target = await dialogs.saveFile(o.fileName, 'binary');
        if (!target) throw new WorkshopError('CANCELLED');
        vault.exportBlob(o.sha256, target);
        audit.record('original.export', 'ok', 'original', o.id);
        return true;
      }),
    'vault:exportVersion': (pid, vid) =>
      wrap(async () => {
        const v = vault.getVersion(id(vid, 'ver'));
        if (!v || v.projectId !== id(pid, 'prj')) throw new WorkshopError('NOT_FOUND', 'version');
        const target = await dialogs.saveFile(`${v.label}.bin`, 'binary');
        if (!target) throw new WorkshopError('CANCELLED');
        vault.exportBlob(v.sha256, target);
        audit.record('version.export', 'ok', 'version', v.id);
        return true;
      }),

    'projects:list': (k) => wrap(() => vault.listProjects(k === undefined ? undefined : kindOf(k))),
    'projects:create': (cid, name) =>
      wrap(() => {
        if (typeof name !== 'string' || !name.trim()) throw new WorkshopError('INVALID_INPUT', 'name');
        return vault.createProject(id(cid), name);
      }),
    'projects:versions': (pid) => wrap(() => vault.listVersions(id(pid, 'prj'))),

    'defs:import': (cid) =>
      wrap(async () => {
        const c = id(cid);
        const f = await dialogs.openFile('definition');
        if (!f) throw new WorkshopError('CANCELLED');
        if (f.data.length > 4 * 1024 * 1024) throw new WorkshopError('INVALID_INPUT', 'definition too large');
        return calibration.importDefinition(c, f.data.toString('utf8'), 'imported');
      }),
    'defs:get': (cid) => wrap(() => calibration.definitionFor(id(cid)) ?? null),

    'cal:maps': (pid, vid) => wrap(() => calibration.readMaps(id(pid, 'prj'), id(vid, 'ver'))),
    'cal:edit': (pid, vid, mapId, edits, note) =>
      wrap(() => {
        if (typeof mapId !== 'string' || mapId.length > 64) throw new WorkshopError('INVALID_INPUT', 'map');
        if (!Array.isArray(edits)) throw new WorkshopError('INVALID_INPUT', 'edits');
        const clean = edits.map((e) => ({ r: Number((e as any)?.r), c: Number((e as any)?.c), value: Number((e as any)?.value) }));
        return calibration.editMap(id(pid, 'prj'), id(vid, 'ver'), mapId, clean, typeof note === 'string' ? note : '');
      }),
    'cal:checks': (pid, vid) => wrap(() => calibration.runChecks(id(pid, 'prj'), id(vid, 'ver'))),
    'cal:diff': (pid, a, b) => wrap(() => calibration.diff(id(pid, 'prj'), a === 'original' ? 'original' : id(a, 'ver'), id(b, 'ver'))),
    'cal:catalog': (cid) => wrap(() => calibration.catalog(id(cid))),
    'cal:compat': (cid) => wrap(() => calibration.compatibility(id(cid))),
    'cal:review': (pid, vid, rid) => wrap(() => calibration.review(id(pid, 'prj'), id(vid, 'ver'), rid ? id(rid, 'req') : undefined)),
    'cal:readiness': (pid, vid, approved) => wrap(() => calibration.writeGate(id(pid, 'prj'), id(vid, 'ver'), approved === true)),

    'req:list': (pid) => wrap(() => calibration.listRequests(pid ? id(pid, 'prj') : undefined)),
    'req:approve': (rid) => wrap(() => calibration.approve(id(rid, 'req'))),
    'req:apply': (rid) => wrap(() => calibration.applyApproved(id(rid, 'req'))),

    'asst:status': () => wrap(() => assistant.status()),
    'asst:ask': (input) =>
      wrap(() => {
        const o = obj(input);
        if (typeof o.text !== 'string' || o.text.length > 4000) throw new WorkshopError('INVALID_INPUT', 'text');
        return assistant.send({ text: o.text, kind: kindOf(o.kind), projectId: o.projectId ? id(o.projectId, 'prj') : undefined });
      }),
    'asst:configure': (key, model) =>
      wrap(() => {
        assistant.configure(key === null ? null : String(key), typeof model === 'string' ? model : undefined);
        return assistant.status();
      }),

    'demo:workspace': () => wrap(() => calibration.createDemoWorkspace()),

    'sessions:list': () => wrap(() => records.listSessions()),
    'sessions:save': (s) =>
      wrap(() => {
        const o = obj(s);
        return records.saveSession({ vehicleId: o.vehicleId ? id(o.vehicleId, 'veh') : undefined, mode: o.mode, title: String(o.title ?? ''), data: o.data });
      }),
    'sessions:exportReport': (sid) =>
      wrap(async () => {
        const s = records.listSessions().find((x) => x.id === id(sid, 'ses'));
        if (!s) throw new WorkshopError('NOT_FOUND', 'session');
        const target = await dialogs.saveFile(`ym-report-${s.createdAt.slice(0, 10)}.html`, 'report');
        if (!target) throw new WorkshopError('CANCELLED');
        fs.writeFileSync(target, renderReport({ title: s.title, mode: s.mode, createdAt: s.createdAt, data: s.data as any }), 'utf8');
        audit.record('diag.report.export', 'ok', 'session', s.id);
        return true;
      }),

    'audit:list': (limit) => wrap(() => audit.list(Math.min(1000, Math.max(1, Number(limit) || 200)))),

    'hw:usb': () => wrap(() => scanUsb()),
    'hw:roadmap': () => wrap(() => PROTOCOL_ROADMAP),

    'net:route': () => wrap(() => defaultRoute()),
    'net:internet': () => wrap(() => checkInternet()),
  };
}

export { MAX_FILE_BYTES };
