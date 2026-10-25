import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ConnectionProfile,
  ConnectionStatus,
  DtcReport,
  LivePid,
  LiveReading,
  ObdErrorInfo,
  Result,
  VehicleIdentity,
  YmApi,
} from '../../shared/types';
import { DemoBackend } from './demoBackend';

export type SessionMode = 'none' | 'live' | 'demo';

export function getApi(): YmApi | null {
  return (window as unknown as { ymApi?: YmApi }).ymApi ?? null;
}

interface Session {
  api: YmApi | null;
  mode: SessionMode;
  status: ConnectionStatus;
  identity: VehicleIdentity | null;
  identityLoading: boolean;
  identityError: ObdErrorInfo | null;
  enterDemo(): void;
  exitDemo(): void;
  connect(profileId: string): Promise<ConnectionStatus | null>;
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  loadIdentity(): Promise<void>;
  readLive(pids: LivePid[]): Promise<Result<LiveReading[]>>;
  readDtcs(): Promise<Result<DtcReport>>;
  profiles: ConnectionProfile[];
  refreshProfiles(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

const internal = (detail: string): ObdErrorInfo => ({ code: 'INTERNAL', detail });

/** Wrap a bridge call so a rejected promise can never escape into the UI. */
async function safe<T>(p: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await p();
  } catch (e) {
    return { ok: false, error: internal(String((e as Error)?.message ?? e)) };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useMemo(getApi, []);
  const demo = useRef<DemoBackend | null>(null);
  const [mode, setMode] = useState<SessionMode>('none');
  const [status, setStatus] = useState<ConnectionStatus>({ phase: 'idle', seq: 0 });
  const [identity, setIdentity] = useState<VehicleIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState<ObdErrorInfo | null>(null);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);

  useEffect(() => {
    if (!api) return;
    void safe(() => api.getStatus()).then((r) => r.ok && setStatus(r.data));
    return api.onStatus((s) => {
      setStatus((prev) => (s.seq >= prev.seq ? s : prev));
      if (s.phase === 'connected') setMode('live');
    });
  }, [api]);

  const refreshProfiles = useCallback(async () => {
    if (!api) return;
    const r = await safe(() => api.listProfiles());
    if (r.ok) setProfiles(r.data);
  }, [api]);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const loadIdentity = useCallback(async () => {
    setIdentityLoading(true);
    setIdentityError(null);
    try {
      if (mode === 'demo' && demo.current) {
        setIdentity(await demo.current.identify());
      } else if (api && mode === 'live') {
        const r = await safe(() => api.identifyVehicle());
        if (r.ok) setIdentity(r.data);
        else setIdentityError(r.error);
      }
    } finally {
      setIdentityLoading(false);
    }
  }, [api, mode]);

  const value: Session = {
    api,
    mode,
    status,
    identity,
    identityLoading,
    identityError,
    profiles,
    refreshProfiles,
    enterDemo: () => {
      demo.current = new DemoBackend();
      setIdentity(null);
      setMode('demo');
    },
    exitDemo: () => {
      demo.current = null;
      setIdentity(null);
      setMode('none');
    },
    connect: async (profileId) => {
      if (!api) return null;
      demo.current = null;
      setIdentity(null);
      setMode('none');
      const r = await safe(() => api.connect(profileId));
      if (!r.ok) {
        setStatus((s) => ({ ...s, phase: 'error', error: r.error, seq: s.seq + 1 }));
        return null;
      }
      setStatus((prev) => (r.data.seq >= prev.seq ? r.data : prev));
      if (r.data.phase === 'connected') setMode('live');
      return r.data;
    },
    cancel: async () => {
      if (api) await safe(() => api.cancelConnect());
    },
    disconnect: async () => {
      if (api) await safe(() => api.disconnect());
      setMode('none');
      setIdentity(null);
    },
    reconnect: async () => {
      if (!api) return;
      const r = await safe(() => api.reconnect());
      if (r.ok && r.data.phase === 'connected') setMode('live');
    },
    loadIdentity,
    readLive: async (pids) => {
      if (mode === 'demo' && demo.current) return { ok: true, data: await demo.current.readLive(pids) };
      if (api && mode === 'live') return safe(() => api.readLive(pids));
      return { ok: false, error: { code: 'NOT_CONNECTED' } };
    },
    readDtcs: async () => {
      if (mode === 'demo' && demo.current) return { ok: true, data: await demo.current.readDtcs() };
      if (api && mode === 'live') return safe(() => api.readDtcs());
      return { ok: false, error: { code: 'NOT_CONNECTED' } };
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
