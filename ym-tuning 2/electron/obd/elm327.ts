import type { Transport } from './transport';
import { ObdError } from './errors';
import { checkCommand, normaliseCommand } from './commandPolicy';

interface Pending {
  resolve: (raw: string) => void;
  reject: (e: ObdError) => void;
  timer: NodeJS.Timeout;
}

/**
 * ELM327-compatible command session. Serialises commands, waits for the '>' prompt,
 * enforces per-command timeouts and the read-only command policy.
 */
export class Elm327Session {
  private buffer = '';
  private pending: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private dead = false;

  constructor(
    private readonly transport: Transport,
    private readonly commandTimeoutMs: number,
  ) {
    transport.on('data', (d: Buffer) => this.onData(d));
    transport.on('close', () => this.fail(new ObdError('CONNECTION_LOST', 'adapter closed the connection')));
  }

  private onData(d: Buffer) {
    this.buffer += d.toString('latin1');
    if (this.buffer.length > 64 * 1024) {
      // A misbehaving device flooding us — drop and fail the current command.
      this.buffer = '';
      this.pending?.reject(new ObdError('UNSUPPORTED_PROTOCOL', 'response too large'));
      return;
    }
    const idx = this.buffer.indexOf('>');
    if (idx >= 0 && this.pending) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(raw);
    }
  }

  private fail(e: ObdError) {
    this.dead = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(e);
      this.pending = null;
    }
  }

  /** Send one command. Rejected before any byte is written if the policy disallows it. */
  send(cmd: string, timeoutMs = this.commandTimeoutMs): Promise<string> {
    const decision = checkCommand(cmd);
    if (!decision.allowed) return Promise.reject(new ObdError('COMMAND_REJECTED', decision.reason));
    const c = normaliseCommand(cmd);
    const run = () =>
      new Promise<string>((resolve, reject) => {
        if (this.dead || !this.transport.isOpen()) {
          reject(new ObdError('NOT_CONNECTED'));
          return;
        }
        this.buffer = '';
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new ObdError('TIMEOUT', `no answer to ${c} within ${timeoutMs} ms`));
        }, timeoutMs);
        this.pending = { resolve, reject, timer };
        try {
          this.transport.write(`${c}\r`);
        } catch (e) {
          clearTimeout(timer);
          this.pending = null;
          reject(e instanceof ObdError ? e : new ObdError('CONNECTION_LOST'));
        }
      });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
