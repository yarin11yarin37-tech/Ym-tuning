import net from 'node:net';
import { EventEmitter } from 'node:events';
import { ObdError, toErrorInfo } from './errors';

/**
 * Transport abstraction. A transport moves bytes to and from an adapter; it knows nothing
 * about OBD. New transports (USB serial, BLE) implement the same interface.
 *
 * Events: 'data' (Buffer), 'close' (unexpected: boolean)
 */
export interface Transport extends EventEmitter {
  readonly kind: string;
  connect(signal?: AbortSignal): Promise<void>;
  write(data: string): void;
  close(): Promise<void>;
  isOpen(): boolean;
}

export interface TcpOptions {
  host: string;
  port: number;
  connectTimeoutMs: number;
}

export class TcpTransport extends EventEmitter implements Transport {
  readonly kind = 'wifi-tcp';
  private socket: net.Socket | null = null;
  private closingIntentionally = false;

  constructor(private readonly opts: TcpOptions) {
    super();
  }

  isOpen(): boolean {
    return !!this.socket && !this.socket.destroyed && this.socket.readyState === 'open';
  }

  connect(signal?: AbortSignal): Promise<void> {
    if (this.socket) return Promise.reject(new ObdError('BUSY', 'transport already in use'));
    if (signal?.aborted) return Promise.reject(new ObdError('CANCELLED'));

    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      this.closingIntentionally = false;
      let settled = false;

      const fail = (err: ObdError) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        this.socket = null;
        reject(err);
      };

      const timer = setTimeout(
        () => fail(new ObdError('TIMEOUT', `no TCP answer within ${this.opts.connectTimeoutMs} ms`)),
        this.opts.connectTimeoutMs,
      );
      const onAbort = () => fail(new ObdError('CANCELLED'));
      const onError = (e: Error) => {
        const info = toErrorInfo(e);
        fail(new ObdError(info.code, info.detail));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        socket.off('error', onError);
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      socket.once('error', onError);
      socket.setNoDelay(true);

      socket.connect(this.opts.port, this.opts.host, () => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.setKeepAlive(true, 5000);
        socket.on('data', (d) => this.emit('data', d));
        // After connect, errors surface as 'close' with unexpected=true.
        socket.on('error', () => undefined);
        socket.on('close', () => {
          const unexpected = !this.closingIntentionally;
          this.socket = null;
          this.emit('close', unexpected);
        });
        resolve();
      });
    });
  }

  write(data: string): void {
    if (!this.isOpen()) throw new ObdError('NOT_CONNECTED');
    this.socket!.write(data, 'ascii');
  }

  close(): Promise<void> {
    const s = this.socket;
    if (!s) return Promise.resolve();
    this.closingIntentionally = true;
    return new Promise((resolve) => {
      const done = () => resolve();
      s.once('close', done);
      s.end();
      // Force-close if the adapter does not finish the TCP shutdown.
      setTimeout(() => {
        if (!s.destroyed) s.destroy();
        resolve();
      }, 800).unref();
    });
  }
}
