import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConnectionProfile } from '../shared/types';
import { validateProfile } from './obd/validation';

const MAX_PROFILES = 20;

/** Connection profiles persisted as JSON in the app's user-data folder. */
export class ProfileStore {
  private readonly file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'connection-profiles.json');
  }

  async list(): Promise<ConnectionProfile[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw
        .map((p) => validateProfile(p))
        .filter((r): r is { ok: true; data: ConnectionProfile } => r.ok)
        .map((r) => r.data);
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<ConnectionProfile | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  async save(p: ConnectionProfile): Promise<ConnectionProfile[]> {
    const all = (await this.list()).filter((x) => x.id !== p.id);
    all.push(p);
    if (all.length > MAX_PROFILES) all.shift();
    await this.write(all);
    return all;
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((p) => p.id !== id));
  }

  private async write(all: ConnectionProfile[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
