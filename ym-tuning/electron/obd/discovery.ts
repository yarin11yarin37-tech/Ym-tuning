import os from 'node:os';
import type { NetworkAdvice, NetworkInterfaceInfo, ProbeResult } from '../../shared/types';
import { TcpTransport } from './transport';
import { Elm327Session } from './elm327';
import { textResponse } from './decode';
import { parseIpv4, validateEndpoint } from './validation';
import { toErrorInfo } from './errors';

/**
 * Discovery policy
 * ----------------
 * - No subnet sweeps. We only probe an explicit, short list of endpoints the user approved
 *   in the UI (their own entry or documented presets they ticked).
 * - Each candidate must sit on a subnet the computer is actually attached to (or loopback,
 *   for adapter emulators), so a typo can't send probes off-network.
 * - At most MAX_CANDIDATES, probed two at a time, each with a short timeout.
 * - UDP discovery is intentionally not implemented: none of the adapters we target documents
 *   a UDP discovery protocol. Add one here only together with the vendor documentation.
 */
export const MAX_CANDIDATES = 8;
const PROBE_TIMEOUT_MS = 1500;

function toInt(o: number[]) {
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  const pa = parseIpv4(a), pb = parseIpv4(b), pm = parseIpv4(mask);
  if (!pa || !pb || !pm) return false;
  const m = toInt(pm);
  return ((toInt(pa) & m) >>> 0) === ((toInt(pb) & m) >>> 0);
}

export function listIpv4Interfaces(
  source: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): NetworkInterfaceInfo[] {
  const out: NetworkInterfaceInfo[] = [];
  for (const [name, list] of Object.entries(source)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address, netmask: i.netmask });
    }
  }
  return out;
}

export function adviseNetwork(host: string, interfaces: NetworkInterfaceInfo[]): NetworkAdvice {
  const match = interfaces.find((i) => sameSubnet(i.address, host, i.netmask));
  const others = interfaces.filter((i) => i !== match);
  return {
    interfaces,
    adapterInterface: match?.name,
    // If the adapter network is the only active one, there is no route to the internet.
    likelyNoInternet: !!match && others.length === 0,
  };
}

export function candidateAllowed(host: string, interfaces: NetworkInterfaceInfo[]): boolean {
  if (host.startsWith('127.')) return true;
  return interfaces.some((i) => sameSubnet(i.address, host, i.netmask));
}

async function probeOne(host: string, port: number): Promise<ProbeResult> {
  const t = new TcpTransport({ host, port, connectTimeoutMs: PROBE_TIMEOUT_MS });
  try {
    await t.connect();
    const s = new Elm327Session(t, PROBE_TIMEOUT_MS);
    const ati = textResponse(await s.send('ATI'));
    return { host, port, ok: true, adapterId: ati };
  } catch (e) {
    return { host, port, ok: false, error: toErrorInfo(e).code };
  } finally {
    await t.close().catch(() => undefined);
  }
}

export async function probeCandidates(
  candidates: { host: string; port: number }[],
  interfaces: NetworkInterfaceInfo[] = listIpv4Interfaces(),
): Promise<ProbeResult[]> {
  const list = candidates.slice(0, MAX_CANDIDATES);
  const results: ProbeResult[] = [];
  const queue = [...list];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift()!;
      if (validateEndpoint(c.host, c.port)) {
        results.push({ host: String(c.host), port: Number(c.port), ok: false, error: 'INVALID_SETTINGS' });
      } else if (!candidateAllowed(c.host, interfaces)) {
        results.push({ host: c.host, port: c.port, ok: false, error: 'UNREACHABLE' });
      } else {
        results.push(await probeOne(c.host, c.port));
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}
