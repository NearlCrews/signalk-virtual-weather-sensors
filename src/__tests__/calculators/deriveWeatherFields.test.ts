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
});
