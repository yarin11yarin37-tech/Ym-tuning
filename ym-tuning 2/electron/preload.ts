import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionStatus, ObdApi, YmApi } from '../shared/types';
import type { WorkshopApi } from '../shared/workshop';

// Sandboxed preloads cannot load local modules, so the channel table is inlined here.
// tests/safety.test.ts asserts it is identical to WORKSHOP_METHOD_CHANNELS in shared/workshop.ts.
const WORKSHOP_METHOD_CHANNELS: Record<keyof WorkshopApi, string> = {
  wsInfo: 'ws:info',
  listCustomers: 'customers:list', saveCustomer: 'customers:save',
  listVehicles: 'vehicles:list', saveVehicle: 'vehicles:save',
  listControllers: 'controllers:list', addController: 'controllers:add',
  listOriginals: 'vault:originals', importOriginal: 'vault:importOriginal', verifyOriginal: 'vault:verify',
  exportOriginal: 'vault:exportOriginal', exportVersion: 'vault:exportVersion',
  listProjects: 'projects:list', createProject: 'projects:create', listVersions: 'projects:versions',
  importDefinition: 'defs:import', getDefinition: 'defs:get',
  readMaps: 'cal:maps', editMap: 'cal:edit', runChecks: 'cal:checks', diff: 'cal:diff', catalog: 'cal:catalog',
  compatibility: 'cal:compat', review: 'cal:review', readinessCheck: 'cal:readiness',
  listRequests: 'req:list', approveRequest: 'req:approve', applyRequest: 'req:apply',
  assistantStatus: 'asst:status', assistantAsk: 'asst:ask', assistantConfigure: 'asst:configure',
  createDemoWorkspace: 'demo:workspace',
  listSessions: 'sessions:list', saveSession: 'sessions:save', exportReport: 'sessions:exportReport',
  auditList: 'audit:list', usbScan: 'hw:usb', protocolRoadmap: 'hw:roadmap',
  defaultRoute: 'net:route', internetCheck: 'net:internet',
};

/**
 * The only bridge between the UI and the machine. Each method maps to one validated IPC
 * channel. There is no generic "invoke" and no raw-command method.
 */
// Workshop methods: one fixed channel per method, arguments passed through to validated handlers.
const workshop = Object.fromEntries(
  Object.entries(WORKSHOP_METHOD_CHANNELS).map(([method, channel]) => [method, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)]),
) as unknown as WorkshopApi;

const obdApi: ObdApi = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (p) => ipcRenderer.invoke('profiles:save', p),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  connect: (id) => ipcRenderer.invoke('obd:connect', id),
  cancelConnect: () => ipcRenderer.invoke('obd:cancel'),
  disconnect: () => ipcRenderer.invoke('obd:disconnect'),
  reconnect: () => ipcRenderer.invoke('obd:reconnect'),
  getStatus: () => ipcRenderer.invoke('obd:status'),
  identifyVehicle: () => ipcRenderer.invoke('obd:identify'),
  readLive: (pids) => ipcRenderer.invoke('obd:readLive', pids),
  readDtcs: () => ipcRenderer.invoke('obd:readDtcs'),
  networkAdvice: (host) => ipcRenderer.invoke('net:advice', host),
  probeCandidates: (c) => ipcRenderer.invoke('net:probe', c),
  onStatus: (cb) => {
    const listener = (_e: unknown, s: ConnectionStatus) => cb(s);
    ipcRenderer.on('obd:status-event', listener);
    return () => ipcRenderer.removeListener('obd:status-event', listener);
  },
};

const api: YmApi = { ...workshop, ...obdApi };

contextBridge.exposeInMainWorld('ymApi', Object.freeze(api));
