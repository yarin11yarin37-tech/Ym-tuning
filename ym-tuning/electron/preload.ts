import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionStatus, YmApi } from '../shared/types';

/**
 * The only bridge between the UI and the machine. Each method maps to one validated IPC
 * channel. There is no generic "invoke" and no raw-command method.
 */
const api: YmApi = {
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

contextBridge.exposeInMainWorld('ymApi', Object.freeze(api));
