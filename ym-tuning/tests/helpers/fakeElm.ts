import net from 'node:net';

export interface FakeElmOptions {
  /** Map of command → raw response (without the trailing prompt). */
  responses?: Record<string, string>;
  /** Commands that never get an answer (to provoke timeouts). */
  silent?: string[];
  /** Delay before each answer, ms. */
  delayMs?: number;
}

const DEFAULTS: Record<string, string> = {
  ATZ: '\r\rELM327 v1.5\r',
  ATI: 'ELM327 v1.5\r',
  ATDP: 'AUTO, ISO 15765-4 (CAN 11/500)\r',
  // Supports 01-20 range incl. 04 05 0B 0C 0D 0F 10 11 20 (so 0120 is queried)
  '0100': 'SEARCHING...\r4100BE3FA813\r',
  '0120': '4120 80000001\r',
  '0140': '4140 40000000\r',
  '010C': '410C1AF8\r', // 1726 rpm
  '010D': '410D32\r', // 50 km/h
  '0105': '41057B\r', // 83 °C
  '0902': '014\r0:490201314731\r1:4A433534343452\r2:37323532333637\r', // 1G1JC5444R7252367
  '090A': 'NO DATA\r',
  '0904': 'NO DATA\r',
  '03': '43020133D016\r', // CAN: count 2 → P0133, U1016
  '07': 'NO DATA\r',
  '0A': '4A00\r',
};

/** In-process ELM327 emulator on 127.0.0.1. Records every command it receives. */
export async function startFakeElm(opts: FakeElmOptions = {}) {
  const responses = { ...DEFAULTS, ...(opts.responses ?? {}) };
  const received: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => undefined);
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i: number;
      while ((i = buf.indexOf('\r')) >= 0) {
        const cmd = buf.slice(0, i).trim().toUpperCase();
        buf = buf.slice(i + 1);
        if (!cmd) continue;
        received.push(cmd);
        if (opts.silent?.includes(cmd)) continue;
        const body = responses[cmd] ?? (cmd.startsWith('AT') ? 'OK\r' : 'NO DATA\r');
        const send = () => !sock.destroyed && sock.write(`${body}\r>`);
        if (opts.delayMs) setTimeout(send, opts.delayMs);
        else send();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    received,
    dropAll() {
      for (const s of sockets) s.destroy();
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export function profile(port: number, over: Record<string, unknown> = {}) {
  return {
    id: 'test',
    name: 'test',
    kind: 'wifi-tcp' as const,
    host: '127.0.0.1',
    port,
    connectTimeoutMs: 1000,
    commandTimeoutMs: 600,
    ...over,
  };
}
