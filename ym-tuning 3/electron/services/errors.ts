import type { ObdErrorCode } from '../../shared/types';

export type WorkshopErrorCode = Exclude<ObdErrorCode, 'UNREACHABLE' | 'TIMEOUT' | 'UNSUPPORTED_PROTOCOL' | 'CONNECTION_LOST' | 'NOT_CONNECTED' | 'BUSY' | 'COMMAND_REJECTED' | 'NO_DATA' | 'INTERNAL' | 'INVALID_SETTINGS'>;

export class WorkshopError extends Error {
  constructor(
    public readonly code: WorkshopErrorCode,
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'WorkshopError';
  }
}
