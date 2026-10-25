import type { ConnectionProfile, ObdErrorInfo, Result } from '../../shared/types';

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function parseIpv4(host: string): number[] | null {
  if (typeof host !== 'string' || !IPV4.test(host.trim())) return null;
  return host.trim().split('.').map(Number);
}

/**
 * Adapters live on the local network. We only accept private, link-local or loopback
 * IPv4 addresses so the app can never be pointed at an arbitrary internet host.
 */
export function isLocalAddress(host: string): boolean {
  const o = parseIpv4(host);
  if (!o) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

export function validateEndpoint(host: unknown, port: unknown): ObdErrorInfo | null {
  if (typeof host !== 'string' || !parseIpv4(host)) {
    return { code: 'INVALID_SETTINGS', detail: 'host must be an IPv4 address' };
  }
  if (!isLocalAddress(host)) {
    return { code: 'INVALID_SETTINGS', detail: 'host must be a local-network address' };
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { code: 'INVALID_SETTINGS', detail: 'port must be an integer 1-65535' };
  }
  return null;
}

export function validateProfile(input: unknown): Result<ConnectionProfile> {
  const bad = (detail: string): Result<ConnectionProfile> => ({
    ok: false,
    error: { code: 'INVALID_SETTINGS', detail },
  });
  if (!input || typeof input !== 'object') return bad('profile must be an object');
  const p = input as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.id)) return bad('invalid id');
  if (typeof p.name !== 'string' || p.name.trim().length === 0 || p.name.length > 60) {
    return bad('invalid name');
  }
  if (p.kind !== 'wifi-tcp') return bad('unsupported transport kind');
  const endpointErr = validateEndpoint(p.host, p.port);
  if (endpointErr) return { ok: false, error: endpointErr };
  const t = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (!t(p.connectTimeoutMs, 500, 30000)) return bad('connect timeout must be 500-30000 ms');
  if (!t(p.commandTimeoutMs, 200, 15000)) return bad('command timeout must be 200-15000 ms');
  return {
    ok: true,
    data: {
      id: p.id,
      name: p.name.trim(),
      kind: 'wifi-tcp',
      host: (p.host as string).trim(),
      port: p.port as number,
      connectTimeoutMs: p.connectTimeoutMs as number,
      commandTimeoutMs: p.commandTimeoutMs as number,
    },
  };
}
