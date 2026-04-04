/**
 * SignalKService Tests
 * Comprehensive tests for vessel navigation data retrieval service
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalKService } from '../../services/SignalKService.js';

// Mock ServerAPI
const createMockApp = (pathValues: Record<string, unknown> = {}) => ({
  getSelfPath: vi.fn((path: string) => pathValues[path] || null),
  handleMessage: vi.fn(),
  setPluginStatus: vi.fn(),
  setPluginError: vi.fn(),
  debug: vi.fn(),
});

// Mock logger
const createMockLogger = () =>
  vi.fn() as unknown as (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>
  ) => void;

describe('SignalKService', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with app and logger', () => {
      const mockApp = createMockApp();
      const service = new SignalKService(mockApp as never, mockLogger);

      expect(service).toBeDefined();
      expect(mockLogger).toHaveBeenCalledWith(
        'info',
        'SignalKService initialized',
        expect.objectContaining({
          maxDataAge: expect.any(Number),
        })
      );
    });

    it('should work without logger', () => {
      const mockApp = createMockApp();
      const service = new SignalKService(mockApp as never);

      expect(service).toBeDefined();
    });
  });

  describe('getVesselPosition', () => {
    it('should return position when available', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.7749, longitude: -122.4194 },
          timestamp: new Date().toISOString(),
          source: { label: 'gps' },
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const position = service.getVesselPosition();

      expect(position).not.toBeNull();
      expect(position?.latitude).toBe(37.7749);
      expect(position?.longitude).toBe(-122.4194);
      expect(position?.isValid).toBe(true);
    });

    it('should return null when position not available', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);
      const position = service.getVesselPosition();

      expect(position).toBeNull();
    });

    it('should return null for invalid coordinates', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 91, longitude: -122.4194 }, // Invalid latitude
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const position = service.getVesselPosition();

      expect(position).toBeNull();
    });

    it('should return null for missing value object', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const position = service.getVesselPosition();

      expect(position).toBeNull();
    });

    it('should exclude node-red sources', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.7749, longitude: -122.4194 },
          timestamp: new Date().toISOString(),
          source: { label: 'signalk-node-red' },
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const position = service.getVesselPosition();

      expect(position).toBeNull();
    });
  });

  describe('getVesselSpeedOverGround', () => {
    it('should return speed when available', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: 5.14, // ~10 knots in m/s
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const speed = service.getVesselSpeedOverGround();

      expect(speed).toBe(5.14);
    });

    it('should return null when speed not available', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);
      const speed = service.getVesselSpeedOverGround();

      expect(speed).toBeNull();
    });

    it('should return null for negative speed', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: -5,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const speed = service.getVesselSpeedOverGround();

      expect(speed).toBeNull();
    });

    it('should return null for excessively high speed', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: 200, // > 100 m/s limit
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const speed = service.getVesselSpeedOverGround();

      expect(speed).toBeNull();
    });
  });

  describe('getVesselCourseOverGroundTrue', () => {
    it('should return course from primary source', () => {
      const mockApp = createMockApp({
        'navigation.courseOverGroundTrue': {
          value: Math.PI / 2, // 90 degrees
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const course = service.getVesselCourseOverGroundTrue();

      expect(course).toBe(Math.PI / 2);
    });

    it('should fallback to magnetic course', () => {
      const mockApp = createMockApp({
        'navigation.courseOverGroundMagnetic': {
          value: Math.PI,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const course = service.getVesselCourseOverGroundTrue();

      expect(course).toBe(Math.PI);
    });

    it('should fallback to heading true', () => {
      const mockApp = createMockApp({
        'navigation.headingTrue': {
          value: 1.5,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const course = service.getVesselCourseOverGroundTrue();

      expect(course).toBe(1.5);
    });

    it('should return null when no course available', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);
      const course = service.getVesselCourseOverGroundTrue();

      expect(course).toBeNull();
    });

    it('should reject invalid course values', () => {
      const mockApp = createMockApp({
        'navigation.courseOverGroundTrue': {
          value: -1, // Invalid (< 0)
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const course = service.getVesselCourseOverGroundTrue();

      expect(course).toBeNull();
    });
  });

  describe('getVesselHeadingTrue', () => {
    it('should return heading when available', () => {
      const mockApp = createMockApp({
        'navigation.headingTrue': {
          value: Math.PI / 4,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const heading = service.getVesselHeadingTrue();

      expect(heading).toBe(Math.PI / 4);
    });

    it('should return null when not available', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);
      const heading = service.getVesselHeadingTrue();

      expect(heading).toBeNull();
    });
  });

  describe('getVesselHeadingMagnetic', () => {
    it('should return magnetic heading when available', () => {
      const mockApp = createMockApp({
        'navigation.headingMagnetic': {
          value: Math.PI / 3,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const heading = service.getVesselHeadingMagnetic();

      expect(heading).toBe(Math.PI / 3);
    });
  });

  describe('getMagneticVariation', () => {
    it('should return variation when available', () => {
      const mockApp = createMockApp({
        'navigation.magneticVariation': {
          value: 0.2, // ~11.5 degrees
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const variation = service.getMagneticVariation();

      expect(variation).toBe(0.2);
    });

    it('should return null for out-of-range variation', () => {
      const mockApp = createMockApp({
        'navigation.magneticVariation': {
          value: 5, // > PI
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const variation = service.getMagneticVariation();

      expect(variation).toBeNull();
    });
  });

  describe('getVesselNavigationData', () => {
    it('should return complete navigation data', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.7749, longitude: -122.4194 },
          timestamp: new Date().toISOString(),
        },
        'navigation.speedOverGround': {
          value: 5.14,
          timestamp: new Date().toISOString(),
        },
        'navigation.courseOverGroundTrue': {
          value: Math.PI / 2,
          timestamp: new Date().toISOString(),
        },
        'navigation.headingTrue': {
          value: Math.PI / 2,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const navData = service.getVesselNavigationData();

      expect(navData.isComplete).toBe(true);
      expect(navData.position?.latitude).toBe(37.7749);
      expect(navData.position?.longitude).toBe(-122.4194);
      expect(navData.speedOverGround).toBe(5.14);
      expect(navData.courseOverGroundTrue).toBe(Math.PI / 2);
    });

    it('should return incomplete when position missing', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: 5.14,
          timestamp: new Date().toISOString(),
        },
        'navigation.courseOverGroundTrue': {
          value: Math.PI / 2,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const navData = service.getVesselNavigationData();

      expect(navData.isComplete).toBe(false);
      expect(navData.position).toBeUndefined();
    });

    it('should return incomplete when speed missing', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.7749, longitude: -122.4194 },
          timestamp: new Date().toISOString(),
        },
        'navigation.courseOverGroundTrue': {
          value: Math.PI / 2,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      const navData = service.getVesselNavigationData();

      expect(navData.isComplete).toBe(false);
    });

    it('should update cache on retrieval', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.7749, longitude: -122.4194 },
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      // First call
      service.getVesselNavigationData();

      // Cached data should exist
      const cachedData = service.getCachedNavigationData();
      expect(cachedData.position).toBeDefined();
    });
  });

  describe('getCachedNavigationData', () => {
    it('should return empty data when no cache', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);
      const cachedData = service.getCachedNavigationData();

      expect(cachedData.isComplete).toBe(false);
      expect(cachedData.position).toBeUndefined();
    });

    it('should return cached data after navigation data retrieval', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 40.0, longitude: -70.0 },
          timestamp: new Date().toISOString(),
        },
        'navigation.speedOverGround': {
          value: 3.0,
          timestamp: new Date().toISOString(),
        },
        'navigation.courseOverGroundTrue': {
          value: 1.0,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      // Retrieve data to populate cache
      service.getVesselNavigationData();

      const cachedData = service.getCachedNavigationData();

      expect(cachedData.position?.latitude).toBe(40.0);
      expect(cachedData.speedOverGround).toBe(3.0);
      expect(cachedData.courseOverGroundTrue).toBe(1.0);
      expect(cachedData.isComplete).toBe(true);
    });
  });

  describe('isVesselMoving', () => {
    it('should return true when speed exceeds threshold', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: 2.0, // > 0.5 m/s default threshold
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      expect(service.isVesselMoving()).toBe(true);
    });

    it('should return false when speed below threshold', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: 0.2, // < 0.5 m/s default threshold
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      expect(service.isVesselMoving()).toBe(false);
    });

    it('should return false when speed not available', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);

      expect(service.isVesselMoving()).toBe(false);
    });

    it('should accept custom threshold', () => {
      const mockApp = createMockApp({
        'navigation.speedOverGround': {
          value: 1.0,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      expect(service.isVesselMoving(0.5)).toBe(true);
      expect(service.isVesselMoving(2.0)).toBe(false);
    });
  });

  describe('getDataAge', () => {
    it('should return null when no cache', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);

      expect(service.getDataAge()).toBeNull();
    });

    it('should return age in seconds after data retrieval', async () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.0, longitude: -122.0 },
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      // Retrieve data to set lastUpdate
      service.getVesselNavigationData();

      // Age should be 0 or very small immediately after
      const age = service.getDataAge();
      expect(age).not.toBeNull();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(5);
    });
  });

  describe('isDataStale', () => {
    it('should return false when no cache', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);

      // No cache means null age, which is not stale
      expect(service.isDataStale()).toBe(false);
    });

    it('should return false for fresh data', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.0, longitude: -122.0 },
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      service.getVesselNavigationData();

      expect(service.isDataStale()).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear cached data', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.0, longitude: -122.0 },
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);

      // Populate cache
      service.getVesselNavigationData();

      // Verify cache has data
      expect(service.getCachedNavigationData().position).toBeDefined();

      // Clear cache
      service.clearCache();

      // Verify cache is empty
      expect(service.getCachedNavigationData().position).toBeUndefined();
      expect(service.getDataAge()).toBeNull();
    });

    it('should log cache cleared', () => {
      const mockApp = createMockApp();

      const service = new SignalKService(mockApp as never, mockLogger);
      service.clearCache();

      expect(mockLogger).toHaveBeenCalledWith('debug', 'SignalK data cache cleared');
    });
  });

  describe('getHealthStatus', () => {
    it('should return running status for fresh data', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.0, longitude: -122.0 },
          timestamp: new Date().toISOString(),
        },
        'navigation.speedOverGround': {
          value: 5.0,
          timestamp: new Date().toISOString(),
        },
        'navigation.courseOverGroundTrue': {
          value: 1.0,
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      service.getVesselNavigationData();

      const health = service.getHealthStatus();

      expect(health.status).toBe('running');
      expect(health.isStale).toBe(false);
      expect(health.hasComplete).toBe(true);
    });

    it('should report incomplete when data missing', () => {
      const mockApp = createMockApp({
        'navigation.position': {
          value: { latitude: 37.0, longitude: -122.0 },
          timestamp: new Date().toISOString(),
        },
      });

      const service = new SignalKService(mockApp as never, mockLogger);
      service.getVesselNavigationData();

      const health = service.getHealthStatus();

      expect(health.hasComplete).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle getSelfPath throwing error', () => {
      const mockApp = {
        getSelfPath: vi.fn(() => {
          throw new Error('SignalK error');
        }),
        handleMessage: vi.fn(),
        debug: vi.fn(),
      };

      const service = new SignalKService(mockApp as never, mockLogger);
      const position = service.getVesselPosition();

      expect(position).toBeNull();
      expect(mockLogger).toHaveBeenCalledWith(
        'error',
        'Error retrieving vessel position',
        expect.objectContaining({ error: 'SignalK error' })
      );
    });
  });
});
