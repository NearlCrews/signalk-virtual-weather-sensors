/**
 * Conversions Util Test Suite
 * Covers temperature/pressure/wind/angle/humidity helpers and the small set
 * of math/atmospheric helpers that ship with the module.
 */

import { describe, expect, it } from 'vitest';
import {
  atmToPascals,
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
  calculateSaturationVaporPressure,
  calculateVaporPressureDeficit,
  celsiusToKelvin,
  clamp,
  convertTemperature,
  degreesToRadians,
  fahrenheitToKelvin,
  inchesHgToPascals,
  isValidCoordinates,
  isValidHumidity,
  isValidNumber,
  isValidPressure,
  isValidTemperature,
  isValidWindDirection,
  isValidWindSpeed,
  isWithinBounds,
  kelvinToCelsius,
  kelvinToFahrenheit,
  kmhToMS,
  knotsToMS,
  millibarsToPA,
  mphToMS,
  msToKMH,
  msToKnots,
  msToMPH,
  normalizeAngle0To2Pi,
  normalizeAnglePiToPi,
  normalizeHumidity,
  pascalsToMillibars,
  percentageChange,
  percentageToRatio,
  radiansToDegrees,
  ratioToPercentage,
  roundTo,
  sanitizeWeatherData,
} from '../../utils/conversions.js';

describe('Temperature conversions', () => {
  it('celsiusToKelvin', () => {
    expect(celsiusToKelvin(0)).toBeCloseTo(273.15, 5);
    expect(celsiusToKelvin(-273.15)).toBeCloseTo(0, 5);
    expect(celsiusToKelvin(100)).toBeCloseTo(373.15, 5);
    expect(celsiusToKelvin(-40)).toBeCloseTo(233.15, 5);
  });

  it('celsiusToKelvin returns 0 for non-finite input', () => {
    expect(celsiusToKelvin(Number.NaN)).toBe(0);
    expect(celsiusToKelvin(Number.POSITIVE_INFINITY)).toBe(0);
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

  it('convertTemperature handles all unit pairs', () => {
    expect(convertTemperature(20, 'C', 'C')).toBe(20);
    expect(convertTemperature(20, 'C', 'K')).toBeCloseTo(293.15, 5);
    expect(convertTemperature(20, 'C', 'F')).toBeCloseTo(68, 5);
    expect(convertTemperature(293.15, 'K', 'C')).toBeCloseTo(20, 5);
    expect(convertTemperature(293.15, 'K', 'F')).toBeCloseTo(68, 5);
    expect(convertTemperature(68, 'F', 'C')).toBeCloseTo(20, 5);
    expect(convertTemperature(68, 'F', 'K')).toBeCloseTo(293.15, 5);
  });

  it('convertTemperature returns 0 for non-finite input', () => {
    expect(convertTemperature(Number.NaN, 'C', 'F')).toBe(0);
  });
});

describe('Pressure conversions', () => {
  it('millibarsToPA / pascalsToMillibars round-trip', () => {
    expect(millibarsToPA(1013.25)).toBeCloseTo(101325, 2);
    expect(pascalsToMillibars(101325)).toBeCloseTo(1013.25, 2);
    expect(millibarsToPA(0)).toBe(0);
    expect(millibarsToPA(Number.NaN)).toBe(0);
    expect(pascalsToMillibars(Number.NaN)).toBe(0);
  });

  it('inchesHgToPascals', () => {
    expect(inchesHgToPascals(29.92)).toBeCloseTo(101324, -1); // ≈ 1 atm
    expect(inchesHgToPascals(0)).toBe(0);
    expect(inchesHgToPascals(Number.NaN)).toBe(0);
  });

  it('atmToPascals', () => {
    expect(atmToPascals(1)).toBeCloseTo(101325, 0);
    expect(atmToPascals(0)).toBe(0);
    expect(atmToPascals(Number.NaN)).toBe(0);
  });
});

describe('Wind speed conversions', () => {
  it('km/h ↔ m/s', () => {
    expect(kmhToMS(36)).toBeCloseTo(10, 5);
    expect(msToKMH(10)).toBeCloseTo(36, 5);
    expect(kmhToMS(Number.NaN)).toBe(0);
    expect(msToKMH(Number.NaN)).toBe(0);
  });

  it('knots ↔ m/s', () => {
    expect(knotsToMS(1)).toBeCloseTo(0.514444, 4);
    expect(msToKnots(0.514444)).toBeCloseTo(1, 4);
    expect(knotsToMS(Number.NaN)).toBe(0);
    expect(msToKnots(Number.NaN)).toBe(0);
  });

  it('mph ↔ m/s', () => {
    expect(mphToMS(1)).toBeCloseTo(0.44704, 4);
    expect(msToMPH(0.44704)).toBeCloseTo(1, 4);
    expect(mphToMS(Number.NaN)).toBe(0);
    expect(msToMPH(Number.NaN)).toBe(0);
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

  describe('normalizeHumidity', () => {
    it('treats values in [0, 1] as ratios', () => {
      expect(normalizeHumidity(0)).toBe(0);
      expect(normalizeHumidity(0.5)).toBeCloseTo(0.5, 5);
      // Boundary: 1.0 is treated as a ratio per current code (humidity <= 1.0 branch)
      expect(normalizeHumidity(1.0)).toBe(1.0);
    });
    it('treats values > 1 as percentages and converts to ratio', () => {
      expect(normalizeHumidity(50)).toBeCloseTo(0.5, 5);
      expect(normalizeHumidity(75)).toBeCloseTo(0.75, 5);
    });
    it('clamps inputs > 100 (percentages) to 1.0', () => {
      expect(normalizeHumidity(150)).toBe(1);
      expect(normalizeHumidity(9999)).toBe(1);
    });
    it('falls back to 0.5 for non-finite input', () => {
      expect(normalizeHumidity(Number.NaN)).toBe(0.5);
    });
  });
});

describe('Math utilities', () => {
  describe('roundTo', () => {
    it('rounds to specified decimals', () => {
      expect(roundTo(1.2345, 2)).toBe(1.23);
      expect(roundTo(1.2355, 2)).toBe(1.24);
      expect(roundTo(1.5, 0)).toBe(2);
      expect(roundTo(-1.236, 2)).toBe(-1.24);
    });
    it('handles 0 decimals', () => {
      expect(roundTo(1.4, 0)).toBe(1);
    });
    it('falls back to 0 for non-finite input', () => {
      expect(roundTo(Number.NaN, 2)).toBe(0);
    });
  });

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

  it('isValidNumber', () => {
    expect(isValidNumber(5)).toBe(true);
    expect(isValidNumber(5, 0, 10)).toBe(true);
    expect(isValidNumber(-1, 0, 10)).toBe(false);
    expect(isValidNumber(11, 0, 10)).toBe(false);
    expect(isValidNumber('5')).toBe(false);
    expect(isValidNumber(Number.NaN)).toBe(false);
  });

  it('percentageChange', () => {
    expect(percentageChange(100, 110)).toBeCloseTo(10, 5);
    expect(percentageChange(100, 50)).toBeCloseTo(-50, 5);
    expect(percentageChange(0, 5)).toBe(0); // div-by-zero guard
    expect(percentageChange(Number.NaN, 5)).toBe(0);
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

  it('isValidWindDirection', () => {
    expect(isValidWindDirection(0)).toBe(true);
    expect(isValidWindDirection(2 * Math.PI)).toBe(true);
    expect(isValidWindDirection(-0.1)).toBe(false);
    expect(isValidWindDirection(7)).toBe(false);
  });

  it('isValidCoordinates', () => {
    expect(isValidCoordinates(0, 0)).toBe(true);
    expect(isValidCoordinates(90, 180)).toBe(true);
    expect(isValidCoordinates(-90, -180)).toBe(true);
    expect(isValidCoordinates(91, 0)).toBe(false);
    expect(isValidCoordinates(0, 181)).toBe(false);
  });

  it('sanitizeWeatherData clamps invalid temperature fields', () => {
    const result = sanitizeWeatherData({
      temperature: 1e6, // wildly out of range
      Temperature: -1e6,
      windSpeed: 5, // unrelated, untouched
    });
    expect(result.temperature).toBeLessThanOrEqual(400); // clamped to MAX
    expect(result.Temperature).toBeGreaterThanOrEqual(150); // clamped to MIN
    expect(result.windSpeed).toBe(5);
  });
});

describe('Atmospheric calculations', () => {
  it('calculateSaturationVaporPressure', () => {
    // At 20°C, saturation vapor pressure is ~2339 Pa
    expect(calculateSaturationVaporPressure(293.15)).toBeCloseTo(2339, -1);
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

  it('calculateVaporPressureDeficit', () => {
    expect(calculateVaporPressureDeficit(293.15, 1.0)).toBeCloseTo(0, 0); // saturated
    const partial = calculateVaporPressureDeficit(293.15, 0.5);
    expect(partial).toBeGreaterThan(0);
    expect(calculateVaporPressureDeficit(Number.NaN, 0.5)).toBe(0);
  });

  describe('calculateBeaufortScale', () => {
    it('classifies sustained wind correctly', () => {
      expect(calculateBeaufortScale(0)).toBe(0);
      expect(calculateBeaufortScale(0.5)).toBe(1);
      expect(calculateBeaufortScale(7)).toBe(4);
      expect(calculateBeaufortScale(35)).toBe(12);
    });
    it('uses higher of sustained or gust speed', () => {
      expect(calculateBeaufortScale(5, 25)).toBe(calculateBeaufortScale(25));
    });
    it('returns 0 for negative or non-finite input', () => {
      expect(calculateBeaufortScale(-1)).toBe(0);
      expect(calculateBeaufortScale(Number.NaN)).toBe(0);
    });
  });
});
