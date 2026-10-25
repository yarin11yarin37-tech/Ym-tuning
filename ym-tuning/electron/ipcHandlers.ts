import type { ConnectionProfile, LivePid, Result } from '../shared/types';
import { LIVE_PIDS } from '../shared/types';
import { ObdService } from './obd/obdService';
import { ProfileStore } from './profileStore';
import { adviseNetwork, listIpv4Interfaces, probeCandidates, MAX_CANDIDATES } from './obd/discovery';
import { validateProfile, parseIpv4 } from './obd/validation';
import { toErrorInfo } from './obd/errors';

/**
 * Every IPC channel the renderer can call, with argument validation. Pure Node — no Electron
 * import — so the whole surface is unit-testable. There is deliberately no channel that
 * accepts a raw adapter command, and no channel related to throttle, actuators or ECU writes.
 */
export const IPC_CHANNELS = [
  'profiles:list',
  'profiles:save',
  'profiles:delete',
  'obd:connect',
  'obd:cancel',
  'obd:disconnect',
  'obd:reconnect',
  'obd:status',
  'obd:identify',
  'obd:readLive',
  'obd:readDtcs',
  'net:advice',
  'net:probe',
] as const;
export type IpcChannel = (typeof IPC_CHANNELS)[number];

type Handler = (...args: unknown[]) => Promise<Result<unknown>>;

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toErrorInfo(e) };
  }
}

const invalid = (detail: string): Result<never> => ({ ok: false, error: { code: 'INVALID_SETTINGS', detail } });

export function createHandlers(service: ObdService, store: ProfileStore): Record<IpcChannel, Handler> {
  return {
    'profiles:list': () => wrap(() => store.list()),
    'profiles:save': async (p) => {
      const v = validateProfile(p);
      if (!v.ok) return v;
      return wrap(async () => {
        await store.save(v.data);
        return v.data;
      });
    },
    'profiles:delete': async (id) => {
      if (typeof id !== 'string' || id.length > 40) return invalid('bad id');
      return wrap(async () => {
        await store.remove(id);
        return true as const;
      });
    },
    'obd:connect': async (id) => {
      if (typeof id !== 'string') return invalid('bad id');
      const profile: ConnectionProfile | undefined = await store.get(id);
      if (!profile) return invalid('unknown profile');
      return wrap(() => service.connect(profile));
    },
    'obd:cancel': () =>
      wrap(async () => {
        service.cancelConnect();
        return true as const;
      }),
    'obd:disconnect': () =>
      wrap(async () => {
        await service.disconnect();
        return true as const;
      }),
    'obd:reconnect': () => wrap(() => service.reconnect()),
    'obd:status': () => wrap(async () => service.getStatus()),
    'obd:identify': () => wrap(() => service.identifyVehicle()),
    'obd:readLive': async (pids) => {
      if (!Array.isArray(pids) || pids.length > LIVE_PIDS.length) return invalid('bad pid list');
      if (!pids.every((p) => (LIVE_PIDS as unknown[]).includes(p))) return invalid('pid not allowed');
      return wrap(() => service.readLive(pids as LivePid[]));
    },
    'obd:readDtcs': () => wrap(() => service.readDtcs()),
    'net:advice': async (host) => {
      if (typeof host !== 'string' || !parseIpv4(host)) return invalid('bad host');
      return wrap(async () => adviseNetwork(host, listIpv4Interfaces()));
    },
    'net:probe': async (list) => {
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CANDIDATES) return invalid('bad candidate list');
      const clean = list.map((c) => ({ host: String((c as any)?.host ?? ''), port: Number((c as any)?.port) }));
      return wrap(() => probeCandidates(clean));
    },
  };
}
