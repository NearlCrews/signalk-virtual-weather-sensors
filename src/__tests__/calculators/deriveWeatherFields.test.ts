import { describe, expect, it } from 'vitest';
import { deriveBaseWeatherFields } from '../../calculators/deriveWeatherFields.js';

describe('deriveBaseWeatherFields', () => {
  it('recomputes the five base-derived fields from temperature, pressure, humidity, and wind', () => {
    const d = deriveBaseWeatherFields(293.15, 101300, 0.5, 5);
    expect(typeof d.windChill).toBe('number');
    expect(typeof d.heatIndex).toBe('number');
    expect(typeof d.beaufortScale).toBe('number');
    expect(typeof d.absoluteHumidity).toBe('number');
    expect(typeof d.airDensityEnhanced).toBe('number');
    // Air density near 1.2 kg/m3 at sea level, mild temperature.
    expect(d.airDensityEnhanced).toBeGreaterThan(1.0);
    expect(d.airDensityEnhanced).toBeLessThan(1.4);
    // Beaufort 3 at 5 m/s.
    expect(d.beaufortScale).toBe(3);
  });

  it('pins Beaufort 0 exactly at 0 m/s', () => {
    const d = deriveBaseWeatherFields(293.15, 101300, 0.5, 0);
    expect(d.beaufortScale).toBe(0);
  });

  it('windChill is below air temperature in cold-plus-windy conditions', () => {
    // 5 C, 15 m/s wind: the Environment Canada / NWS formula should give a
    // wind chill below the actual air temperature.
    const tempK = 278.15; // 5 C
    const windMs = 15;
    const d = deriveBaseWeatherFields(tempK, 101300, 0.5, windMs);
    expect(d.windChill).toBeLessThan(tempK);
  });

  it('heatIndex equals air temperature when below the NWS heat-index threshold', () => {
    // 15 C (59 F) is well below the 80 F / 26.7 C activation gate.
    // The calculator returns the raw temperature when the gate is not met.
    const tempK = 288.15; // 15 C
    const d = deriveBaseWeatherFields(tempK, 101300, 0.5, 3);
    expect(d.heatIndex).toBeCloseTo(tempK, 5);
  });

  it('pins absoluteHumidity to expected value within tolerance', () => {
    // At 20 C and 50% RH: saturation vapour pressure ~2338 Pa, so
    // absolute humidity ~ 0.002166 * 0.5 * 2338 / 293.15 ~ 0.00864 kg/m3.
    const d = deriveBaseWeatherFields(293.15, 101325, 0.5, 0);
    expect(d.absoluteHumidity).toBeGreaterThan(0.008);
    expect(d.absoluteHumidity).toBeLessThan(0.01);
  });

  it('pins airDensityEnhanced to expected value within tolerance', () => {
    // Dry air at 20 C, 101325 Pa: ~1.204 kg/m3; slight reduction with 50% RH.
    const d = deriveBaseWeatherFields(293.15, 101325, 0.5, 0);
    expect(d.airDensityEnhanced).toBeGreaterThan(1.18);
    expect(d.airDensityEnhanced).toBeLessThan(1.22);
  });
});
