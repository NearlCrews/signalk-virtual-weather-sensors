import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../../types/index.js';
import type { RequestWindowSnapshot } from './RollingRequestWindow.js';

interface StoredRequestWindow {
  readonly version: 1;
  readonly cumulative: number;
  readonly timestamps: ReadonlyArray<number>;
}

/** Small atomic JSON store for the quota window in the plugin data directory. */
export class RequestWindowStore {
  constructor(
    private readonly path: string,
    private readonly logger: Logger = () => {}
  ) {}

  public load(): RequestWindowSnapshot | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoredRequestWindow>;
      if (
        parsed.version !== 1 ||
        !Number.isSafeInteger(parsed.cumulative) ||
        !Array.isArray(parsed.timestamps) ||
        !parsed.timestamps.every(Number.isFinite)
      ) {
        throw new Error('invalid request-window document');
      }
      return { cumulative: parsed.cumulative as number, timestamps: parsed.timestamps as number[] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger('warn', 'Ignoring unreadable AccuWeather quota state', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return undefined;
    }
  }

  public save(snapshot: RequestWindowSnapshot): void {
    const tempPath = `${this.path}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const document: StoredRequestWindow = { version: 1, ...snapshot };
      writeFileSync(tempPath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(tempPath, this.path);
    } catch (error) {
      this.logger('warn', 'Unable to persist AccuWeather quota state', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
