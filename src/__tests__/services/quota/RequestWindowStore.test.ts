import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RequestWindowStore } from '../../../services/quota/RequestWindowStore.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('RequestWindowStore', () => {
  it('round-trips an exact quota snapshot through an atomic JSON file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vws-quota-'));
    directories.push(directory);
    const path = join(directory, 'quota.json');
    const store = new RequestWindowStore(path);
    store.save({ cumulative: 3, timestamps: [10, 20, 30] });
    expect(store.load()).toEqual({ cumulative: 3, timestamps: [10, 20, 30] });
    expect(readFileSync(path, 'utf8')).toContain('"version":1');
  });
});
