/**
 * Unit tests for MarinePathMapper: canonical SST and current node, producer
 * wave/swell paths, the distinct marine $source, and the meta delta.
 */

import { describe, expect, it } from 'vitest';
import { MarinePathMapper } from '../../mappers/MarinePathMapper.js';
import type { MarineData } from '../../types/index.js';
import { getValuesFromDelta as getValues } from '../setup.js';

const FULL: MarineData = {
  timestamp: '2026-06-16T23:45',
  significantWaveHeight: 1.2,
  wavePeriod: 6,
  waveDirection: Math.PI,
  windWaveHeight: 0.6,
  swellHeight: 0.8,
  swellPeriod: 8,
  swellDirection: Math.PI / 2,
  seaSurfaceTemperature: 287.15,
  surfaceCurrentSpeed: 1.0,
  surfaceCurrentDirection: Math.PI / 4,
};

describe('MarinePathMapper', () => {
  const mapper = new MarinePathMapper();

  it('maps SST to the canonical water.temperature leaf', () => {
    const values = getValues(mapper.mapToSignalKPaths(FULL));
    expect(values).toContainEqual({ path: 'environment.water.temperature', value: 287.15 });
  });

  it('emits environment.current as a single object node, not dotted leaves', () => {
    const values = getValues(mapper.mapToSignalKPaths(FULL));
    const current = values.find((v) => v.path === 'environment.current');
    expect(current?.value).toEqual({ drift: 1.0, setTrue: Math.PI / 4 });
    // No dotted current leaves.
    expect(values.some((v) => v.path.startsWith('environment.current.'))).toBe(false);
  });

  it('emits producer-namespaced wave and swell paths', () => {
    const paths = getValues(mapper.mapToSignalKPaths(FULL)).map((v) => v.path);
    expect(paths).toContain('environment.water.waves.significantHeight');
    expect(paths).toContain('environment.water.waves.period');
    expect(paths).toContain('environment.water.waves.direction');
    expect(paths).toContain('environment.water.waves.windWaveHeight');
    expect(paths).toContain('environment.water.swell.height');
    expect(paths).toContain('environment.water.swell.period');
    expect(paths).toContain('environment.water.swell.direction');
  });

  it('stamps the distinct marine $source and the reading timestamp', () => {
    const update = mapper.mapToSignalKPaths(FULL).updates[0];
    expect(update).toHaveProperty('$source', 'open-meteo-marine');
    expect(update).toHaveProperty('timestamp', '2026-06-16T23:45');
  });

  it('omits fields the model did not provide', () => {
    const partial = mapper.mapToSignalKPaths({ timestamp: 't', significantWaveHeight: 0.5 });
    const paths = getValues(partial).map((v) => v.path);
    expect(paths).toEqual(['environment.water.waves.significantHeight']);
  });

  it('builds a meta delta covering the producer wave and swell leaves', () => {
    const meta = mapper.buildMetaDelta().updates[0];
    const metaPaths = (meta as { meta: Array<{ path: string }> }).meta.map((m) => m.path);
    expect(metaPaths).toContain('environment.water.waves.significantHeight');
    expect(metaPaths).toContain('environment.water.swell.height');
    expect(meta).toHaveProperty('$source', 'open-meteo-marine');
  });
});
