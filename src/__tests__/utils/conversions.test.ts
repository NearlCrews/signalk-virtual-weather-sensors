/**
 * Conversions Util Test Suite
 * Covers temperature/pressure/wind/angle/humidity helpers and the small set
 * of math/atmospheric helpers that ship with the module.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
  calculateSaturationVaporPressure,
  celsiusToKelvin,
  clamp,
  degreesToRadians,
  fahrenheitToKelvin,
  isApiQuotaReached,
  isValidCoordinates,
  isValidHumidity,
  isValidPressure,
  isValidTemperature,
  isValidWindSpeed,
  isWithinBounds,
  kelvinToCelsius,
  kelvinToFahrenheit,
  kmhToMS,
  millibarsToPA,
  msToKMH,
  msToKnots,
  normalizeAngle0To2Pi,
  normalizeAnglePiToPi,
  percentageToRatio,
  radiansToDegrees,
  ratioToPercentage,
} from '../../utils/conversions.js';

describe('Temperature conversions', () => {
  it('celsiusToKelvin', () => {
    expect(celsiusToKelvin(0)).toBeCloseTo(273.15, 5);
    expect(celsiusToKelvin(-273.15)).toBeCloseTo(0, 5);
    expect(celsiusToKelvin(100)).toBeCloseTo(373.15, 5);
    expect(celsiusToKelvin(-40)).toBeCloseTo(233.15, 5);
  });

  it('celsiusToKelvin returns the 0°C-equivalent for non-finite input', () => {
    // Matches the 0°C-equivalent fallback of the sibling temperature converters
    // rather than flooring garbage to absolute zero.
    expect(celsiusToKelvin(Number.NaN)).toBe(273.15);
    expect(celsiusToKelvin(Number.POSITIVE_INFINITY)).toBe(273.15);
  });

  it('kelvinToCelsius', () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 5);
    expect(kelvinToCelsius(0)).toBeCloseTo(-273.15, 5);
    expect(kelvinToCelsius(Number.NaN)).toBe(0);
  });

  it('kelvinToFahrenheit', () => {
    expect(kelvinToFahrenheit(273.15)).toBeCloseTo(32, 5);
    expect(kelvinToFahrenheit(373.15)).toBeCloseTo(212, 5);
    expect(kelvinToFahrenheit(255.372)).toBeCloseTo(0, 1);
    // Documented fallback for non-finite inputs is 32°F
    expect(kelvinToFahrenheit(Number.NaN)).toBe(32);
  });

  it('fahrenheitToKelvin', () => {
    expect(fahrenheitToKelvin(32)).toBeCloseTo(273.15, 5);
    expect(fahrenheitToKelvin(212)).toBeCloseTo(373.15, 5);
    expect(fahrenheitToKelvin(0)).toBeCloseTo(255.372, 2);
    // Non-finite falls back to 0°C in Kelvin (273.15)
    expect(fahrenheitToKelvin(Number.NaN)).toBeCloseTo(273.15, 5);
  });
});

describe('Pressure conversions', () => {
  it('millibarsToPA', () => {
    expect(millibarsToPA(1013.25)).toBeCloseTo(101325, 2);
    expect(millibarsToPA(0)).toBe(0);
    expect(millibarsToPA(Number.NaN)).toBe(0);
  });
});

describe('Wind speed conversions', () => {
  it('km/h ↔ m/s', () => {
    expect(kmhToMS(36)).toBeCloseTo(10, 5);
    expect(msToKMH(10)).toBeCloseTo(36, 5);
    expect(kmhToMS(Number.NaN)).toBe(0);
    expect(msToKMH(Number.NaN)).toBe(0);
  });

  it('m/s → knots', () => {
    expect(msToKnots(0.514444)).toBeCloseTo(1, 4);
    expect(msToKnots(Number.NaN)).toBe(0);
  });
});

describe('Angle conversions', () => {
  it('degrees ↔ radians', () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 5);
    expect(radiansToDegrees(Math.PI)).toBeCloseTo(180, 5);
    expect(degreesToRadians(Number.NaN)).toBe(0);
    expect(radiansToDegrees(Number.NaN)).toBe(0);
  });

  describe('normalizeAngle0To2Pi', () => {
    it('returns input for in-range values', () => {
      expect(normalizeAngle0To2Pi(0)).toBe(0);
      expect(normalizeAngle0To2Pi(Math.PI)).toBeCloseTo(Math.PI, 5);
    });
    it('wraps negative inputs into [0, 2π)', () => {
      expect(normalizeAngle0To2Pi(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 5);
      expect(normalizeAngle0To2Pi(-2 * Math.PI)).toBeCloseTo(0, 5);
    });
    it('wraps inputs greater than 2π back into [0, 2π)', () => {
      expect(normalizeAngle0To2Pi(3 * Math.PI)).toBeCloseTo(Math.PI, 5);
      expect(normalizeAngle0To2Pi(4 * Math.PI)).toBeCloseTo(0, 5);
    });
    it('falls back to 0 for non-finite input', () => {
      expect(normalizeAngle0To2Pi(Number.NaN)).toBe(0);
    });
  });

  describe('normalizeAnglePiToPi', () => {
    it('keeps in-range values', () => {
      expect(normalizeAnglePiToPi(0)).toBe(0);
      expect(normalizeAnglePiToPi(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 5);
    });
    it('wraps values above π into negative range', () => {
      expect(normalizeAnglePiToPi((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 5);
    });
    it('wraps values below -π into positive range', () => {
      expect(normalizeAnglePiToPi(-(3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 5);
    });
    it('falls back to 0 for non-finite input', () => {
      expect(normalizeAnglePiToPi(Number.NaN)).toBe(0);
    });
    it('maps -π to +π (the documented "wrapped === 0" boundary)', () => {
      // Mutation guard: the conditional `wrapped === 0 ? Math.PI : wrapped - Math.PI`
      // is the only place where -π collapses to +π. Without this case, tests pass
      // even when the conditional is flipped to always return `wrapped - Math.PI`.
      expect(normalizeAnglePiToPi(-Math.PI)).toBe(Math.PI);
      expect(normalizeAnglePiToPi(Math.PI)).toBe(Math.PI);
    });
  });
});

describe('Humidity conversions', () => {
  it('percentage ↔ ratio with clamping', () => {
    expect(percentageToRatio(50)).toBeCloseTo(0.5, 5);
    expect(percentageToRatio(150)).toBe(1);
    expect(percentageToRatio(-10)).toBe(0);
    expect(ratioToPercentage(0.5)).toBeCloseTo(50, 5);
    expect(ratioToPercentage(1.5)).toBe(100);
    expect(ratioToPercentage(-1)).toBe(0);
    expect(percentageToRatio(Number.NaN)).toBe(0);
    expect(ratioToPercentage(Number.NaN)).toBe(0);
  });
});

describe('Math utilities', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });

  it('isWithinBounds', () => {
    expect(isWithinBounds(5, 0, 10)).toBe(true);
    expect(isWithinBounds(0, 0, 10)).toBe(true);
    expect(isWithinBounds(10, 0, 10)).toBe(true);
    expect(isWithinBounds(-1, 0, 10)).toBe(false);
    expect(isWithinBounds(Number.NaN, 0, 10)).toBe(false);
  });
});

describe('Validation helpers', () => {
  it('isValidTemperature', () => {
    expect(isValidTemperature(293.15)).toBe(true);
    expect(isValidTemperature(0)).toBe(false); // outside expected K range
  });

  it('isValidPressure', () => {
    expect(isValidPressure(101325)).toBe(true);
    expect(isValidPressure(0)).toBe(false);
  });

  it('isValidHumidity', () => {
    expect(isValidHumidity(0.5)).toBe(true);
    expect(isValidHumidity(50)).toBe(false);
  });

  it('isValidWindSpeed', () => {
    expect(isValidWindSpeed(10)).toBe(true);
    expect(isValidWindSpeed(-1)).toBe(false);
  });

  it('isValidCoordinates', () => {
    expect(isValidCoordinates(0, 0)).toBe(true);
    expect(isValidCoordinates(90, 180)).toBe(true);
    expect(isValidCoordinates(-90, -180)).toBe(true);
    expect(isValidCoordinates(91, 0)).toBe(false);
    expect(isValidCoordinates(0, 181)).toBe(false);
  });
});

describe('Atmospheric calculations', () => {
  it('calculateSaturationVaporPressure', () => {
    // At 20°C the August-Roche-Magnus formula yields ~2333 Pa
    // (slightly lower than the WMO reference 2339 Pa; both are within
    // the variant tolerance of ~5-10 Pa).
    expect(calculateSaturationVaporPressure(293.15)).toBeCloseTo(2333, -2);
    expect(calculateSaturationVaporPressure(Number.NaN)).toBe(0);
  });

  it('calculateAbsoluteHumidity', () => {
    // At 20°C, 50% RH, absolute humidity ≈ 8.65 g/m³
    const result = calculateAbsoluteHumidity(293.15, 0.5);
    expect(result).toBeGreaterThan(0.005);
    expect(result).toBeLessThan(0.015);
    expect(calculateAbsoluteHumidity(Number.NaN, 0.5)).toBe(0);
  });

  it('calculateAirDensity', () => {
    // Standard air density at 15°C, sea-level pressure ≈ 1.225 kg/m³
    expect(calculateAirDensity(288.15, 101325, 0)).toBeCloseTo(1.225, 2);
    // Non-finite fallback
    expect(calculateAirDensity(Number.NaN, 101325)).toBe(1.225);
    // Out-of-range result fallback
    expect(calculateAirDensity(1, 0, 0)).toBe(1.225);
  });

  it('calculateAirDensity decreases when humidity > 0 at the same T/P', () => {
    // Mutation guard: the dry-vs-humid branch (`relativeHumidity * saturationPressure`,
    // `pressurePa - vaporPressure`, `(p_d/(R_d*T)) + (p_v/(R_v*T))`) is dead-code in tests
    // that always pass relativeHumidity = 0. Humid air is less dense than dry air at the
    // same pressure & temperature, so this assertion kills the "swap +/-" and "swap *//"
    // mutations on those terms.
    const dry = calculateAirDensity(293.15, 101325, 0);
    const humid = calculateAirDensity(293.15, 101325, 0.9);
    expect(humid).toBeLessThan(dry);
    expect(dry - humid).toBeGreaterThan(0.005); // measurable, not just numerical noise
  });

  describe('calculateBeaufortScale', () => {
    it('classifies sustained wind correctly', () => {
      expect(calculateBeaufortScale(0)).toBe(0);
      expect(calculateBeaufortScale(0.5)).toBe(1);
      expect(calculateBeaufortScale(7)).toBe(4);
      expect(calculateBeaufortScale(35)).toBe(12);
    });
    it('returns 0 for negative or non-finite input', () => {
      expect(calculateBeaufortScale(-1)).toBe(0);
      expect(calculateBeaufortScale(Number.NaN)).toBe(0);
    });
    it('uses strict less-than at threshold boundaries (mutation guard)', () => {
      // Threshold table starts with `{ max: 0.3, scale: 0 }`. The lookup uses
      // `effectiveWindSpeed < threshold.max`, so 0.299 → 0 and 0.3 → 1. Mutating
      // `<` to `<=` would push 0.3 into scale 0 instead of 1.
      expect(calculateBeaufortScale(0.299)).toBe(0);
      expect(calculateBeaufortScale(0.3)).toBe(1);
    });
  });
});

describe('isApiQuotaReached', () => {
  it('returns false when quota is 0 (disabled)', () => {
    expect(isApiQuotaReached(100, 0)).toBe(false);
  });

  it('returns false when usage is below the quota', () => {
    expect(isApiQuotaReached(49, 50)).toBe(false);
  });

  it('returns true when usage equals the quota', () => {
    expect(isApiQuotaReached(50, 50)).toBe(true);
  });

  it('returns true when usage exceeds the quota', () => {
    expect(isApiQuotaReached(51, 50)).toBe(true);
  });

  it('returns false for a non-finite quota', () => {
    expect(isApiQuotaReached(50, Number.NaN)).toBe(false);
  });

  it('returns false for an undefined quota (cap disabled)', () => {
    expect(isApiQuotaReached(50, undefined)).toBe(false);
  });
});
