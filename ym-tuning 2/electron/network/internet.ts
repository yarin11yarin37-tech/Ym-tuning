/**
 * Read-only network inspection: default route and internet reachability.
 * Never changes routes, interfaces or Wi-Fi networks — the OS default route is left untouched.
 */
import net from 'node:net';
import { execFile } from 'node:child_process';
import type { DefaultRoute, InternetCheck } from '../../shared/workshop';

export function parseDarwinRoute(out: string): DefaultRoute {
  const iface = out.match(/^\s*interface:\s*(\S+)/m)?.[1];
  const gateway = out.match(/^\s*gateway:\s*(\S+)/m)?.[1];
  return { iface, gateway, known: !!iface };
}

export function parseLinuxRoute(out: string): DefaultRoute {
  const m = out.match(/default via (\S+) dev (\S+)/);
  return m ? { gateway: m[1], iface: m[2], known: true } : { known: false };
}

/** `route print -4 0.0.0.0` → lowest-metric default route's interface address. */
export function parseWindowsRoute(out: string): DefaultRoute {
  let best: { gw: string; iface: string; metric: number } | null = null;
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\S+)\s+(\d+)/);
    if (m && (!best || +m[3] < best.metric)) best = { gw: m[1], iface: m[2], metric: +m[3] };
  }
  return best ? { gateway: best.gw, iface: best.iface, known: true } : { known: false };
}

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout: 3000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout))),
  );
}

export async function defaultRoute(platform: NodeJS.Platform = process.platform): Promise<DefaultRoute> {
  if (platform === 'darwin') {
    const out = await run('/sbin/route', ['-n', 'get', 'default']);
    return out ? parseDarwinRoute(out) : { known: false };
  }
  if (platform === 'win32') {
    const out = await run('route', ['print', '-4', '0.0.0.0']);
    return out ? parseWindowsRoute(out) : { known: false };
  }
  if (platform === 'linux') {
    const out = await run('ip', ['route', 'show', 'default']);
    return out ? parseLinuxRoute(out) : { known: false };
  }
  return { known: false };
}

/**
 * Internet reachability: a TCP handshake to well-known public resolvers on port 443.
 * No data is sent. Used before and after connecting to an adapter.
 */
export async function checkInternet(
  targets: { host: string; port: number }[] = [
    { host: '1.1.1.1', port: 443 },
    { host: '8.8.8.8', port: 443 },
  ],
  timeoutMs = 2500,
): Promise<InternetCheck> {
  const attempt = (t: { host: string; port: number }) =>
    new Promise<number | null>((resolve) => {
      const t0 = Date.now();
      const s = net.connect({ host: t.host, port: t.port });
      const done = (ok: boolean) => {
        s.destroy();
        resolve(ok ? Date.now() - t0 : null);
      };
      s.setTimeout(timeoutMs, () => done(false));
      s.once('connect', () => done(true));
      s.once('error', () => done(false));
    });
  const results = await Promise.all(targets.map(attempt));
  const idx = results.findIndex((r) => r !== null);
  return {
    online: idx >= 0,
    latencyMs: idx >= 0 ? results[idx]! : undefined,
    via: idx >= 0 ? `${targets[idx].host}:${targets[idx].port}` : undefined,
    checkedAt: new Date().toISOString(),
  };
}
