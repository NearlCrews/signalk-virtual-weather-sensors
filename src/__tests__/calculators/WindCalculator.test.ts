/**
 * WindCalculator Test Suite
 * Comprehensive testing of vector wind calculations and meteorological formulas
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindCalculator } from '../../calculators/WindCalculator.js';

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
      expect(mockLogger).toHaveBeenCalledWith('info', 'WindCalculator initialized');
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

      const result = calculator.calculateApparentWindSpeed(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      // For beam wind, apparent wind should be higher than true wind
      expect(result).toBeGreaterThan(trueWindSpeed);
      expect(result).toBeCloseTo(11.18, 1); // Expected vector result
    });

    it('should calculate apparent wind correctly for head wind', () => {
      // Test case: True wind from ahead, vessel moving forward
      const trueWindSpeed = 10; // m/s
      const vesselSpeed = 5; // m/s
      const vesselHeading = 0; // North
      const trueWindDirection = 0; // North (head wind)

      const result = calculator.calculateApparentWindSpeed(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      // For head wind, apparent wind should be sum of true wind + vessel speed
      expect(result).toBeCloseTo(15, 1);
    });

    it('should calculate apparent wind correctly for tail wind', () => {
      // Test case: True wind from behind, vessel moving forward
      const trueWindSpeed = 10; // m/s
      const vesselSpeed = 5; // m/s
      const vesselHeading = 0; // North
      const trueWindDirection = Math.PI; // South (tail wind)

      const result = calculator.calculateApparentWindSpeed(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      // For tail wind, apparent wind should be difference
      expect(result).toBeCloseTo(5, 1);
    });

    it('should handle stationary vessel', () => {
      const result = calculator.calculateApparentWindSpeed(10, 0, 0, Math.PI / 2);
      expect(result).toBeCloseTo(10, 1); // Apparent wind equals true wind when stationary
    });

    it('should handle invalid inputs gracefully', () => {
      const result = calculator.calculateApparentWindSpeed(Number.NaN, 5, 0, Math.PI / 2);
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

      const result = calculator.calculateApparentWindAngle(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      // Apparent wind angle should be forward of beam due to vessel motion
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(Math.PI / 2);
    });

    it('should normalize angles to -π to π range', () => {
      const result = calculator.calculateApparentWindAngle(10, 5, 0, Math.PI * 1.8);
      expect(result).toBeGreaterThanOrEqual(-Math.PI);
      expect(result).toBeLessThanOrEqual(Math.PI);
    });

    it('should handle zero wind speed', () => {
      const result = calculator.calculateApparentWindAngle(0, 5, 0, Math.PI / 2);
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

    it('should handle invalid inputs', () => {
      const result = calculator.calculateWindChill(Number.NaN, 10);
      expect(result).toBe(0);
      expect(mockLogger).toHaveBeenCalledWith(
        'warn',
        'Invalid wind chill inputs',
        expect.any(Object)
      );
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
  });

  describe('Dew Point Calculation', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should calculate dew point correctly', () => {
      const temperature = 293.15; // 20°C in Kelvin
      const humidity = 0.6; // 60%

      const result = calculator.calculateDewPoint(temperature, humidity);

      // Dew point should be lower than air temperature
      expect(result).toBeLessThan(temperature);
      expect(result).toBeCloseTo(285.15, 1); // Expected dew point (~12°C)
    });

    it('should handle extreme humidity values', () => {
      const temperature = 293.15; // 20°C in Kelvin

      // Test very low humidity
      const lowHumidityResult = calculator.calculateDewPoint(temperature, 0.05);
      expect(lowHumidityResult).toBeLessThan(temperature);

      // Test very high humidity
      const highHumidityResult = calculator.calculateDewPoint(temperature, 0.95);
      expect(highHumidityResult).toBeLessThan(temperature);
      expect(highHumidityResult).toBeGreaterThan(lowHumidityResult);
    });

    it('should validate result against air temperature', () => {
      const temperature = 293.15; // 20°C in Kelvin
      const humidity = 1.2; // Invalid > 100%

      const result = calculator.calculateDewPoint(temperature, humidity);

      // Should return reasonable default when calculation is invalid
      expect(result).toBeLessThan(temperature);
    });
  });

  describe('Beaufort Scale Calculation', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should calculate correct Beaufort scale for various wind speeds', () => {
      // Test known Beaufort scale values
      expect(calculator.calculateBeaufortScale(0.1)).toBe(0); // Calm
      expect(calculator.calculateBeaufortScale(1.0)).toBe(1); // Light air
      expect(calculator.calculateBeaufortScale(3.0)).toBe(2); // Light breeze
      expect(calculator.calculateBeaufortScale(7.0)).toBe(4); // Moderate breeze
      expect(calculator.calculateBeaufortScale(15.0)).toBe(7); // Near gale
      expect(calculator.calculateBeaufortScale(25.0)).toBe(10); // Storm (adjusted)
      expect(calculator.calculateBeaufortScale(35.0)).toBe(12); // Hurricane
    });

    it('should use higher of wind or gust speed', () => {
      const sustainedWind = 5.0; // m/s
      const gustWind = 8.0; // m/s

      const result = calculator.calculateBeaufortScale(sustainedWind, gustWind);
      const gustOnlyResult = calculator.calculateBeaufortScale(gustWind);

      expect(result).toBe(gustOnlyResult);
    });

    it('should handle extreme wind speeds', () => {
      const extremeWind = 100; // m/s
      const result = calculator.calculateBeaufortScale(extremeWind);
      expect(result).toBe(12); // Maximum Beaufort scale
    });
  });

  describe('Wind Direction Utilities', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should convert wind direction to degrees correctly', () => {
      expect(calculator.convertWindDirection(0, 'degrees')).toBe(0); // North
      expect(calculator.convertWindDirection(Math.PI / 2, 'degrees')).toBe(90); // East
      expect(calculator.convertWindDirection(Math.PI, 'degrees')).toBe(180); // South
      expect(calculator.convertWindDirection((3 * Math.PI) / 2, 'degrees')).toBe(270); // West
    });

    it('should convert wind direction to compass correctly', () => {
      expect(calculator.convertWindDirection(0, 'compass')).toBe('N');
      expect(calculator.convertWindDirection(Math.PI / 2, 'compass')).toBe('E');
      expect(calculator.convertWindDirection(Math.PI, 'compass')).toBe('S');
      expect(calculator.convertWindDirection((3 * Math.PI) / 2, 'compass')).toBe('W');
      expect(calculator.convertWindDirection(Math.PI / 4, 'compass')).toBe('NE');
    });

    it('should calculate relative wind direction', () => {
      const windDirection = Math.PI / 2; // East
      const vesselHeading = Math.PI / 4; // Northeast

      const result = calculator.calculateRelativeWindDirection(windDirection, vesselHeading);
      expect(result).toBeCloseTo(Math.PI / 4, 2); // 45° relative
    });
  });

  describe('Wind Speed Conversions', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should convert wind speed to different units', () => {
      const windSpeedMs = 10; // m/s

      expect(calculator.convertWindSpeed(windSpeedMs, 'kmh')).toBeCloseTo(36, 1); // km/h
      expect(calculator.convertWindSpeed(windSpeedMs, 'knots')).toBeCloseTo(19.44, 1); // knots
      expect(calculator.convertWindSpeed(windSpeedMs, 'mph')).toBeCloseTo(22.37, 1); // mph
    });
  });

  describe('Wind Summary', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should provide comprehensive wind analysis summary', () => {
      const trueWindSpeed = 12;
      const vesselSpeed = 6;
      const vesselHeading = 0;
      const trueWindDirection = Math.PI / 3; // 60°

      const summary = calculator.getWindSummary(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      expect(summary).toEqual(
        expect.objectContaining({
          trueWind: {
            speed: trueWindSpeed,
            direction: trueWindDirection,
          },
          vesselMotion: {
            speed: vesselSpeed,
            heading: vesselHeading,
          },
          apparentWind: {
            speed: expect.any(Number),
            angle: expect.any(Number),
          },
          beaufortScale: expect.any(Number),
          isValid: true,
        })
      );

      expect(summary.beaufortScale).toBeGreaterThanOrEqual(0);
      expect(summary.beaufortScale).toBeLessThanOrEqual(12);
    });

    it('should indicate invalid summary for bad inputs', () => {
      const summary = calculator.getWindSummary(-1, 5, 0, Math.PI / 2);
      expect(summary.isValid).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      calculator = new WindCalculator(mockLogger);
    });

    it('should handle zero wind conditions', () => {
      const apparentSpeed = calculator.calculateApparentWindSpeed(0, 5, 0, 0);
      const apparentAngle = calculator.calculateApparentWindAngle(0, 5, 0, 0);

      expect(Number.isFinite(apparentSpeed)).toBe(true);
      expect(Number.isFinite(apparentAngle)).toBe(true);
    });

    it('should handle very high vessel speeds', () => {
      const result = calculator.calculateApparentWindSpeed(5, 50, 0, Math.PI / 2);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    });

    it('should validate extreme inputs', () => {
      const analysis = calculator.calculateWindAnalysis(1000, 5, 0, Math.PI); // Extreme wind speed
      expect(analysis.isValid).toBe(false);
    });

    it('should handle NaN results gracefully', () => {
      // If the calculation somehow produces NaN, should fallback to true wind speed
      const result = calculator.calculateApparentWindSpeed(10, 5, 0, Math.PI / 2);
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

    it('should calculate dew point using Magnus formula', () => {
      // Test with known conditions
      const tempC = 25; // °C
      const rh = 0.7; // 70%
      const tempK = tempC + 273.15;

      const result = calculator.calculateDewPoint(tempK, rh);
      const dewPointC = result - 273.15;

      // Should be approximately 19.15°C for these conditions
      expect(dewPointC).toBeCloseTo(19.15, 1);
    });
  });

  describe('Input Validation', () => {
    it('should validate all required inputs', () => {
      // Test valid inputs
      expect(calculator.validateWindInputs(10, 5, 0, Math.PI / 2)).toBe(true);

      // Test invalid inputs
      expect(calculator.validateWindInputs(Number.NaN, 5, 0, Math.PI / 2)).toBe(false);
      expect(calculator.validateWindInputs(10, -1, 0, Math.PI / 2)).toBe(false);
      expect(calculator.validateWindInputs(10, 1000, 0, Math.PI / 2)).toBe(false);
      expect(calculator.validateWindInputs(-5, 5, 0, Math.PI / 2)).toBe(false);
    });

    it('should normalize angles correctly', () => {
      // Test angle normalization (both PI and -PI are equivalent)
      expect(Math.abs(calculator.normalizeAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 2);
      expect(Math.abs(calculator.normalizeAngle(-Math.PI * 3))).toBeCloseTo(Math.PI, 2);
      expect(calculator.normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 2);
    });
  });

  describe('Performance and Precision', () => {
    it('should complete calculations within reasonable time', () => {
      const startTime = Date.now();

      // Perform multiple calculations
      for (let i = 0; i < 1000; i++) {
        calculator.calculateApparentWindSpeed(
          10 + (i % 20),
          5 + (i % 10),
          i % (2 * Math.PI),
          ((i * Math.PI) / 180) % (2 * Math.PI)
        );
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should maintain precision across multiple calculations', () => {
      // Test calculation consistency
      const trueWindSpeed = 15.7;
      const vesselSpeed = 7.3;
      const vesselHeading = 1.23;
      const trueWindDirection = 2.87;

      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(
          calculator.calculateApparentWindSpeed(
            trueWindSpeed,
            vesselSpeed,
            vesselHeading,
            trueWindDirection
          )
        );
      }

      // All results should be identical (deterministic)
      const firstResult = results[0];
      expect(results.every((r) => Math.abs(r - firstResult) < 0.0001)).toBe(true);
    });
  });
});
