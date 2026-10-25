import type { ObdApi, Result, YmApi } from '../../shared/types';
import { createWebWorkshop, type WebFiles } from './webWorkshop';

/** Browser file picker + download, used by the in-browser demo. */
export const browserFiles: WebFiles = {
  openFile(kind) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = kind === 'definition' ? '.json,application/json' : '.bin,.ori,.mod,.dump,.hex,.ihex,.s19,.s28,.s37,.srec,.mot';
      input.style.display = 'none';
      let done = false;
      input.addEventListener('change', async () => {
        done = true;
        const f = input.files?.[0];
        input.remove();
        resolve(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
      });
      // If the dialog is dismissed, the window regains focus without a change event.
      window.addEventListener('focus', () => setTimeout(() => { if (!done) { input.remove(); resolve(null); } }, 1500), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  },
  download(name, data, mime) {
    const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

const notHere = async <T,>(): Promise<Result<T>> => ({ ok: false, error: { code: 'NOT_SUPPORTED', detail: 'desktop app only' } });

/** OBD surface in the browser: there is no adapter access, so every vehicle call says so. */
const webObd: ObdApi = {
  listProfiles: async () => ({ ok: true, data: [] }),
  saveProfile: notHere,
  deleteProfile: notHere,
  connect: notHere,
  cancelConnect: async () => ({ ok: true, data: true }),
  disconnect: async () => ({ ok: true, data: true }),
  reconnect: notHere,
  getStatus: async () => ({ ok: true, data: { phase: 'idle', seq: 0 } }),
  identifyVehicle: notHere,
  readLive: notHere,
  readDtcs: notHere,
  networkAdvice: notHere,
  probeCandidates: notHere,
  onStatus: () => () => undefined,
};

let instance: YmApi | null = null;
export function getWebApi(): YmApi {
  instance ??= { ...createWebWorkshop(browserFiles), ...webObd, runtime: 'web' };
  return instance;
}
