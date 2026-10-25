import type { ObdErrorCode, ObdErrorInfo } from '../../shared/types';

export class ObdError extends Error {
  constructor(
    public readonly code: ObdErrorCode,
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ObdError';
  }
  toInfo(): ObdErrorInfo {
    return { code: this.code, detail: this.detail };
  }
}

/** Normalise anything thrown into a structured error the UI can translate. */
export function toErrorInfo(e: unknown): ObdErrorInfo {
  if (e instanceof ObdError) return e.toInfo();
  if (e && typeof e === 'object' && (e as any).name === 'WorkshopError') {
    return { code: (e as any).code, detail: (e as any).detail };
  }
  // SQLite trigger aborts surface as plain errors carrying our marker text.
  const msg = String((e as Error)?.message ?? '');
  if (msg.includes('ORIGINAL_IMMUTABLE') || msg.includes('VERSION_IMMUTABLE')) return { code: 'INTEGRITY', detail: msg.slice(0, 120) };
  const err = e as NodeJS.ErrnoException | undefined;
  switch (err?.code) {
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'EADDRNOTAVAIL':
      return { code: 'UNREACHABLE', detail: err.code };
    case 'ETIMEDOUT':
      return { code: 'TIMEOUT', detail: err.code };
    case 'ECONNRESET':
    case 'EPIPE':
      return { code: 'CONNECTION_LOST', detail: err.code };
    default:
      return { code: 'INTERNAL', detail: err?.message ? String(err.message).slice(0, 200) : undefined };
  }
}
