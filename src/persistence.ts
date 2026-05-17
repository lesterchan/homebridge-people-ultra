import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Logging } from 'homebridge';

export class PersistenceStore {
  private state: Record<string, number> = {};
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly filePath: string,
    private readonly log: Logging,
  ) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.load();
  }

  getNumber(key: string): number | undefined {
    return this.state[key];
  }

  setNumber(key: string, value: number) {
    this.state[key] = value;
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 500);
  }

  private load() {
    try {
      const contents = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(contents) as Record<string, unknown>;
      this.state = Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.warn('Unable to read People Ultra persistence file: %s', (error as Error).message);
      }
    }
  }

  private save() {
    try {
      writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    } catch (error) {
      this.log.warn('Unable to write People Ultra persistence file: %s', (error as Error).message);
    }
  }
}