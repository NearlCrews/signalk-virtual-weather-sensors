/**
 * WindCalculator Test Suite
 * Comprehensive testing of vector wind calculations and meteorological formulas
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindCalculator } from '../../calculators/WindCalculator.js';
import { normalizeAnglePiToPi } from '../../utils/conversions.js';

describe('WindCalculator', () => {
  let calculator: WindCalculator;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = vi.fn();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with logger', () => {
      calculator = new WindCalculator(mockLogger);
      expect(mockLogger).toHaveBeenCalledWith('debug', expect.stringContaining('initialized'));
    });

    it('should work with default logger', () => {
      expect(() => new WindCalculator()).not.toThrow();
    });
  });

  describe('Apparent Wind Speed Calculation', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });
    it('should calculate apparent wind correctly for beam wind', () => {
      // Test case: True wind from beam (90°), vessel moving forward
      const trueWindSpeed = 10; // m/s
      const vesselSpeed = 5; // m/s
      const vesselHeading = 0; // North
      const trueWindDirection = Math.PI / 2; // East (beam wind)

      const result = calculator.calculateWindAnalysis(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      ).apparentWindSpeed;

      // Tight tolerance kills sin/cos swap mutations: sqrt(10^2 + 5^2) = 11.180339887...
      // (also subsumes the looser "apparent > true" inequality for a beam wind).
      expect(result).toBeCloseTo(11.180339887498949, 6);
    });

    it('beam wind angle matches the exact vector result (atan2(10, 5) ≈ 1.1071 rad)', () => {
      // Mutation guard: the `Math.atan2(apparentWindY, apparentWindX) - vesselHeading`
      // expression has multiple ArithmeticOperator survivors when only loose
      // `toBeGreaterThan(0) && toBeLessThan(π/2)` assertions are used. Pinning the
      // exact angle (and therefore the cos/sin ordering in the X/Y formulas) kills them.
      const angle = calculator.calculateWindAnalysis(10, 5, 0, Math.PI / 2).apparentWindAngle;
      expect(angle).toBeCloseTo(1.1071487177940904, 6);
    });

    it('should calculate apparent wind correctly for head wind', () => {
      // Test case: True wind from ahead, vessel moving forward
      const trueWindSpeed = 10; // m/s
      const vesselSpeed = 5; // m/s
      const vesselHeading = 0; // North
      const trueWindDirection = 0; // North (head wind)

      const result = calculator.calculateWindAnalysis(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      ).apparentWindSpeed;

      // For head wind, apparent wind should be sum of true wind + vessel speed
      expect(result).toBeCloseTo(15, 1);
    });

    it('should calculate apparent wind correctly for tail wind', () => {
      // Test case: True wind from behind, vessel moving forward
      const trueWindSpeed = 10; // m/s
      const vesselSpeed = 5; // m/s
      const vesselHeading = 0; // North
      const trueWindDirection = Math.PI; // South (tail wind)

      const result = calculator.calculateWindAnalysis(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      ).apparentWindSpeed;

      // For tail wind, apparent wind should be difference
      expect(result).toBeCloseTo(5, 1);
    });

    it('should handle stationary vessel', () => {
      const result = calculator.calculateWindAnalysis(10, 0, 0, Math.PI / 2).apparentWindSpeed;
      expect(result).toBeCloseTo(10, 1); // Apparent wind equals true wind when stationary
    });

    it('should handle invalid inputs gracefully', () => {
      const result = calculator.calculateWindAnalysis(
        Number.NaN,
        5,
        0,
        Math.PI / 2
      ).apparentWindSpeed;
      expect(result).toBe(0);
      expect(mockLogger).toHaveBeenCalledWith(
        'warn',
        'Invalid wind calculation inputs',
        expect.any(Object)
      );
    });
  });

  describe('Apparent Wind Angle Calculation', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should calculate apparent wind angle correctly for beam wind', () => {
      // Test case: True wind from beam, vessel moving forward
      const trueWindSpeed = 10; // m/s
      const vesselSpeed = 5; // m/s
      const vesselHeading = 0; // North
      const trueWindDirection = Math.PI / 2; // East (90°)

      const result = calculator.calculateWindAnalysis(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      ).apparentWindAngle;

      // Apparent wind angle should be forward of beam due to vessel motion
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(Math.PI / 2);
    });

    it('should normalize angles to -π to π range', () => {
      const result = calculator.calculateWindAnalysis(10, 5, 0, Math.PI * 1.8).apparentWindAngle;
      expect(result).toBeGreaterThanOrEqual(-Math.PI);
      expect(result).toBeLessThanOrEqual(Math.PI);
    });

    it('should handle zero wind speed', () => {
      const result = calculator.calculateWindAnalysis(0, 5, 0, Math.PI / 2).apparentWindAngle;
      expect(result).toBeDefined();
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  describe('Wind Analysis', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should provide comprehensive wind analysis', () => {
      const analysis = calculator.calculateWindAnalysis(10, 5, 0, Math.PI / 2);

      expect(analysis).toEqual(
        expect.objectContaining({
          apparentWindSpeed: expect.any(Number),
          apparentWindAngle: expect.any(Number),
          isValid: true,
        })
      );

      expect(analysis.isValid).toBe(true);
      expect(analysis.validationErrors).toBeUndefined();
    });

    it('should return invalid analysis for bad inputs', () => {
      const analysis = calculator.calculateWindAnalysis(-1, 5, 0, Math.PI / 2); // Negative wind speed

      expect(analysis.isValid).toBe(false);
      expect(analysis.validationErrors).toContain('Invalid input parameters');
    });
  });

  describe('Wind Chill Calculation', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should calculate wind chill for cold conditions', () => {
      const temperature = 273.15; // 0°C in Kelvin
      const windSpeed = 10; // m/s (36 km/h)

      const result = calculator.calculateWindChill(temperature, windSpeed);

      // Wind chill should be lower than air temperature
      expect(result).toBeLessThan(temperature);
      expect(result).toBeCloseTo(266.1, 1); // Expected wind chill
    });

    it('should return original temperature for warm conditions', () => {
      const temperature = 283.15; // 10°C in Kelvin (above wind chill threshold)
      const windSpeed = 10; // m/s

      const result = calculator.calculateWindChill(temperature, windSpeed);

      // Wind chill not applicable above 10°C
      expect(result).toBe(temperature);
    });

    it('should return original temperature for low wind', () => {
      const temperature = 268.15; // -5°C in Kelvin
      const windSpeed = 1; // m/s (3.6 km/h, below threshold)

      const result = calculator.calculateWindChill(temperature, windSpeed);

      // Wind chill not applicable below 4.8 km/h
      expect(result).toBe(temperature);
    });

    it('should handle invalid inputs by falling back to input temperature', () => {
      const temperature = 280.15; // 7°C in Kelvin
      const result = calculator.calculateWindChill(temperature, Number.NaN);
      // Falls back to input temperature, matching calculateHeatIndex
      // rather than returning literal 0K (≈ -273°C)
      expect(result).toBe(temperature);
      expect(mockLogger).toHaveBeenCalledWith(
        'warn',
        'Invalid wind chill inputs',
        expect.any(Object)
      );
    });

    it('propagates a non-finite input temperature instead of returning 0 K', () => {
      const result = calculator.calculateWindChill(Number.NaN, 10);
      expect(result).toBeNaN();
    });

    it('boundary: just-above the 4.8 km/h wind threshold computes a chill below temperature', () => {
      // Mutation guard: the gate `windKmh < WIND_CHILL_MIN_SPEED_KMH` flipped to `<=`
      // would cause exactly 4.8 km/h (≈ 1.3333 m/s) to be skipped. Pin the threshold
      // by feeding a wind speed just above it and asserting the formula actually fires.
      const tempK = 263.15; // -10°C, well below the 10°C upper gate
      const justAbove = 4.81 / 3.6; // m/s
      const out = calculator.calculateWindChill(tempK, justAbove);
      expect(out).toBeLessThan(tempK);
    });
  });

  describe('Heat Index Calculation', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should calculate heat index for hot, humid conditions', () => {
      const temperature = 308.15; // 35°C in Kelvin (95°F)
      const humidity = 0.8; // 80%

      const result = calculator.calculateHeatIndex(temperature, humidity);

      // Heat index should be higher than air temperature
      expect(result).toBeGreaterThan(temperature);
    });

    it('should return original temperature for mild conditions', () => {
      const temperature = 293.15; // 20°C in Kelvin (68°F, below threshold)
      const humidity = 0.6; // 60%

      const result = calculator.calculateHeatIndex(temperature, humidity);

      // Heat index not applicable below 80°F
      expect(result).toBe(temperature);
    });

    it('should return original temperature for low humidity', () => {
      const temperature = 308.15; // 35°C in Kelvin (95°F)
      const humidity = 0.3; // 30% (below threshold)

      const result = calculator.calculateHeatIndex(temperature, humidity);

      // Heat index not applicable below 40% humidity
      expect(result).toBe(temperature);
    });

    it('should handle extreme conditions with adjustments', () => {
      const temperature = 315.15; // 42°C in Kelvin (107.6°F)
      const humidity = 0.9; // 90%

      const result = calculator.calculateHeatIndex(temperature, humidity);

      expect(result).toBeGreaterThan(temperature);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('falls back to input temperature when one of the inputs is non-finite', () => {
      // Coverage guard: the `!Number.isFinite(temperatureK) || !Number.isFinite(relativeHumidity)`
      // early return in calculateHeatIndex.
      const tempK = 300.15;
      expect(calculator.calculateHeatIndex(tempK, Number.NaN)).toBe(tempK);
      expect(calculator.calculateHeatIndex(Number.NaN, 0.5)).toBeNaN();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should handle zero wind conditions', () => {
      const analysis = calculator.calculateWindAnalysis(0, 5, 0, 0);

      expect(Number.isFinite(analysis.apparentWindSpeed)).toBe(true);
      expect(Number.isFinite(analysis.apparentWindAngle)).toBe(true);
    });

    it('should handle very high vessel speeds', () => {
      const result = calculator.calculateWindAnalysis(5, 50, 0, Math.PI / 2).apparentWindSpeed;
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    });

    it('should validate extreme inputs', () => {
      const analysis = calculator.calculateWindAnalysis(1000, 5, 0, Math.PI); // Extreme wind speed
      expect(analysis.isValid).toBe(false);
    });

    it('should handle NaN results gracefully', () => {
      // If the calculation somehow produces NaN, should fallback to true wind speed
      const result = calculator.calculateWindAnalysis(10, 5, 0, Math.PI / 2).apparentWindSpeed;
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  describe('Meteorological Formula Accuracy', () => {
    it('should calculate wind chill using Environment Canada formula', () => {
      // Test with known values
      const tempC = -10; // °C
      const windKmh = 50; // km/h
      const tempK = tempC + 273.15;
      const windMs = windKmh / 3.6;

      const result = calculator.calculateWindChill(tempK, windMs);
      const resultC = result - 273.15;

      // Should be approximately -21.8°C for these conditions
      expect(resultC).toBeCloseTo(-21.8, 1);
    });

    it('should calculate heat index using Rothfusz regression', () => {
      // Test with known values (hot, humid conditions)
      const tempF = 90; // °F
      const rhPercent = 85; // %
      const tempK = ((tempF - 32) * 5) / 9 + 273.15;
      const rh = rhPercent / 100;

      const result = calculator.calculateHeatIndex(tempK, rh);
      const resultF = ((result - 273.15) * 9) / 5 + 32;

      // Should be significantly higher than air temperature
      expect(resultF).toBeGreaterThan(tempF + 10);
    });

    it('Rothfusz heat index matches NWS reference at 95°F / 70% RH (no adjustment branch)', () => {
      // Mutation guard: existing tests use loose `toBeGreaterThan` assertions on the heat
      // index, so any sign / coefficient flip in the 9-term Rothfusz polynomial still passes.
      // 95°F + 70% RH → 122.6°F is the published NWS reference value. The full polynomial
      // must be intact to land within 1°F of this.
      const tempK = ((95 - 32) * 5) / 9 + 273.15;
      const result = calculator.calculateHeatIndex(tempK, 0.7);
      const resultF = ((result - 273.15) * 9) / 5 + 32;
      expect(resultF).toBeCloseTo(122.6, 1);
    });

    it('Rothfusz high-humidity adjustment branch matches reference at 85°F / 90% RH', () => {
      // Mutation guard: the `r > 85 && t >= 80 && t <= 87` branch and its
      // `((r - 85) / 10) * ((87 - t) / 5)` correction.
      // Reference: NOAA HI table, 85°F / 90% ≈ 101.8°F.
      const tempK = ((85 - 32) * 5) / 9 + 273.15;
      const result = calculator.calculateHeatIndex(tempK, 0.9);
      const resultF = ((result - 273.15) * 9) / 5 + 32;
      expect(resultF).toBeCloseTo(101.8, 1);
    });
  });

  describe('Angle Normalization', () => {
    it('should normalize angles correctly', () => {
      // Both PI and -PI are equivalent endpoints; calling the shared conversion
      // directly since WindCalculator no longer wraps it as a public method.
      expect(Math.abs(normalizeAnglePiToPi(Math.PI * 3))).toBeCloseTo(Math.PI, 2);
      expect(Math.abs(normalizeAnglePiToPi(-Math.PI * 3))).toBeCloseTo(Math.PI, 2);
      expect(normalizeAnglePiToPi(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 2);
    });
  });

  describe('Precision', () => {
    // Wall-clock perf assertions (e.g. "1000 iterations under 100ms") were
    // removed: they fired false negatives on slow CI runners while telling
    // us nothing the deterministic precision check below does not already.
    it('should maintain precision across multiple calculations', () => {
      // Test calculation consistency
      const trueWindSpeed = 15.7;
      const vesselSpeed = 7.3;
      const vesselHeading = 1.23;
      const trueWindDirection = 2.87;

      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(
          calculator.calculateWindAnalysis(
            trueWindSpeed,
            vesselSpeed,
            vesselHeading,
            trueWindDirection
          ).apparentWindSpeed
        );
      }

      // All results should be identical (deterministic)
      const firstResult = results[0];
      expect(results.every((r) => Math.abs(r - firstResult) < 0.0001)).toBe(true);
    });
  });

  describe('Invalid-input fallback shape', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('invalid input never yields a negative apparentWindSpeed (negative truthy guard)', () => {
      // Mutation guard: `trueWindSpeed || 0` would surface -5 as the fallback
      // because negatives are truthy. The fallback must clamp to a non-negative
      // value so the failure contract cannot leak a meaningless negative speed.
      const result = calculator.calculateWindAnalysis(-5, 2, 0, Math.PI / 2);
      expect(result.isValid).toBe(false);
      expect(result.apparentWindSpeed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Apparent wind angle: full-frame coverage', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('rotates correctly under a 90 deg eastward vessel heading', () => {
      // Vessel pointing east (heading π/2), motion east at 5 m/s. True wind
      // from north (direction 0) at 10 m/s. Convention: each direction is a
      // FROM-bearing; the vector formula sums them in their FROM-frame.
      //  apparentX = 10*cos(0) + 5*cos(π/2) = 10
      //  apparentY = 10*sin(0) + 5*sin(π/2) = 5
      //  world FROM = atan2(5, 10) = 0.4636 rad (NNE)
      //  bow-relative = 0.4636 - π/2 = -1.1071 rad (port side, forward of beam)
      const angle = calculator.calculateWindAnalysis(10, 5, Math.PI / 2, 0).apparentWindAngle;
      expect(angle).toBeCloseTo(-1.1071487177940904, 6);
    });

    it('separate vesselCourse and vesselHeading produce different bow-relative angles', () => {
      // The 5th argument (vesselHeading) defaults to course but can differ
      // due to leeway / set. Test that the rotation actually depends on it.
      const aligned = calculator.calculateWindAnalysis(10, 5, 0, Math.PI / 2);
      const skewed = calculator.calculateWindAnalysis(10, 5, 0, Math.PI / 2, 0.5);
      expect(aligned.apparentWindAngle).not.toBeCloseTo(skewed.apparentWindAngle, 3);
    });

    it('tail wind apparent angle lands on +π (still from astern after vector subtraction)', () => {
      const angle = calculator.calculateWindAnalysis(10, 5, 0, Math.PI).apparentWindAngle;
      expect(Math.abs(angle)).toBeCloseTo(Math.PI, 6);
    });

    it('head wind apparent angle lands on 0 (dead-ahead)', () => {
      const angle = calculator.calculateWindAnalysis(10, 5, 0, 0).apparentWindAngle;
      expect(angle).toBeCloseTo(0, 6);
    });

    it('zero true wind: apparent wind angle is dead-ahead (matches vessel motion direction)', () => {
      // True wind = 0, vessel motion = 5 m/s along heading 0 (north). The
      // apparent wind is then exactly the negated motion: comes from the
      // direction the vessel is moving toward, i.e. dead-ahead.
      const result = calculator.calculateWindAnalysis(0, 5, 0, Math.PI / 2);
      expect(result.apparentWindAngle).toBeCloseTo(0, 6);
      expect(result.apparentWindSpeed).toBeCloseTo(5, 6);
    });
  });
});
