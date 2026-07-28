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
      const cumulative = parsed.cumulative;
      const timestamps = parsed.timestamps;
      if (
        parsed.version !== 1 ||
        typeof cumulative !== 'number' ||
        !Number.isSafeInteger(cumulative) ||
        cumulative < 0 ||
        !Array.isArray(timestamps) ||
        !timestamps.every((timestamp) => Number.isSafeInteger(timestamp) && timestamp >= 0) ||
        cumulative < timestamps.length
      ) {
        throw new Error('invalid request-window document');
      }
      return { cumulative, timestamps };
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
