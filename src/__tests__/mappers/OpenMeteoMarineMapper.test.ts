/**
 * Unit tests for the Open-Meteo Marine current-block to MarineData mapper:
 * unit conversions, direction handling, and graceful handling of an inland
 * (empty) response.
 */

import { describe, expect, it } from 'vitest';
import {
  isMarineDataEmpty,
  mapOpenMeteoMarineToMarineData,
} from '../../mappers/OpenMeteoMarineMapper.js';
import type { OpenMeteoMarineResponse } from '../../types/index.js';

function sample(overrides: Record<string, unknown> = {}): OpenMeteoMarineResponse {
  return {
    current: {
      time: '2026-06-16T23:45',
      wave_height: 0.12,
      wave_direction: 326,
      wave_period: 2.3,
      wind_wave_height: 0.06,
      swell_wave_height: 0.08,
      swell_wave_direction: 333,
      swell_wave_period: 2.2,
      ocean_current_velocity: 3.6,
      ocean_current_direction: 90,
      sea_surface_temperature: 13.9,
      ...overrides,
    },
  };
}

describe('mapOpenMeteoMarineToMarineData', () => {
  it('maps wave, swell, SST, and current with SI conversions', () => {
    const data = mapOpenMeteoMarineToMarineData(sample());
    expect(data.significantWaveHeight).toBe(0.12);
    expect(data.wavePeriod).toBe(2.3);
    expect(data.windWaveHeight).toBe(0.06);
    expect(data.swellHeight).toBe(0.08);
    expect(data.swellPeriod).toBe(2.2);
    // SST: 13.9 C -> 287.05 K.
    expect(data.seaSurfaceTemperature).toBeCloseTo(287.05, 2);
    // Current: 3.6 km/h -> 1.0 m/s.
    expect(data.surfaceCurrentSpeed).toBeCloseTo(1.0, 6);
    // GMT wall-clock string normalized to an RFC 3339 UTC instant (Z appended).
    expect(data.timestamp).toBe('2026-06-16T23:45:00.000Z');
  });

  it('converts directions from degrees to radians in [0, 2pi)', () => {
    const data = mapOpenMeteoMarineToMarineData(sample());
    expect(data.surfaceCurrentDirection).toBeCloseTo(Math.PI / 2, 5); // 90 deg
    expect(data.waveDirection).toBeCloseTo((326 * Math.PI) / 180, 5);
    expect(data.swellDirection).toBeCloseTo((333 * Math.PI) / 180, 5);
    for (const dir of [data.waveDirection, data.swellDirection, data.surfaceCurrentDirection]) {
      expect(dir).toBeGreaterThanOrEqual(0);
      expect(dir as number).toBeLessThan(2 * Math.PI);
    }
  });

  it('omits fields that are missing or null', () => {
    const data = mapOpenMeteoMarineToMarineData(
      sample({ ocean_current_velocity: null, sea_surface_temperature: undefined })
    );
    expect(data.surfaceCurrentSpeed).toBeUndefined();
    expect(data.seaSurfaceTemperature).toBeUndefined();
    expect(data.significantWaveHeight).toBe(0.12);
  });

  it('returns just a timestamp and reports empty for an inland point', () => {
    const inland = mapOpenMeteoMarineToMarineData({ current: { time: '2026-06-16T23:45' } });
    expect(inland.significantWaveHeight).toBeUndefined();
    expect(isMarineDataEmpty(inland)).toBe(true);
  });

  it('handles a completely absent current block', () => {
    const data = mapOpenMeteoMarineToMarineData({});
    expect(data.timestamp).toBe('');
    expect(isMarineDataEmpty(data)).toBe(true);
  });

  it('reports non-empty when any sea-state field is present', () => {
    expect(isMarineDataEmpty(mapOpenMeteoMarineToMarineData(sample()))).toBe(false);
  });
});
