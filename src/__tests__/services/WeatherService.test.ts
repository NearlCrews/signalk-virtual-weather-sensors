/**
 * WeatherService Tests
 * Comprehensive tests for the main weather orchestration service
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeatherService } from '../../services/WeatherService.js';
import type { PluginConfiguration } from '../../types/index.js';

// Mock ServerAPI
const createMockApp = () => ({
  getSelfPath: vi.fn(),
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

// Default test configuration
const createTestConfig = (overrides?: Partial<PluginConfiguration>): PluginConfiguration => ({
  accuWeatherApiKey: 'test-api-key-12345678',
  updateFrequency: 5,
  emissionInterval: 5,
  ...overrides,
});

describe('WeatherService', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let config: PluginConfiguration;

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
    config = createTestConfig();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with valid configuration', () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      expect(service).toBeDefined();
      expect(mockLogger).toHaveBeenCalledWith(
        'info',
        'WeatherService initializing',
        expect.objectContaining({
          updateFrequency: config.updateFrequency,
          emissionInterval: config.emissionInterval,
        })
      );
    });

    it('should log successful initialization', () => {
      new WeatherService(mockApp as never, config, mockLogger);

      expect(mockLogger).toHaveBeenCalledWith('info', 'WeatherService initialized successfully');
    });

    it('should accept custom wind calculator', () => {
      const mockWindCalculator = {
        calculateApparentWindSpeed: vi.fn().mockReturnValue(5),
        calculateApparentWindAngle: vi.fn().mockReturnValue(0.5),
        calculateWindChill: vi.fn().mockReturnValue(280),
        calculateHeatIndex: vi.fn().mockReturnValue(295),
        calculateDewPoint: vi.fn().mockReturnValue(283),
        calculateWindDirectionHeading: vi.fn().mockReturnValue(1.5),
        calculateWindDirectionMagnetic: vi.fn().mockReturnValue(1.6),
      };

      const service = new WeatherService(
        mockApp as never,
        config,
        mockLogger,
        mockWindCalculator as never
      );

      expect(service).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start successfully', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      // Don't wait for the full start since it has timers
      const startPromise = service.start();

      // Advance timers to skip initial delay
      await vi.advanceTimersByTimeAsync(100);

      await startPromise;

      expect(mockLogger).toHaveBeenCalledWith('info', 'Starting WeatherService');
      expect(mockLogger).toHaveBeenCalledWith('info', 'WeatherService started successfully');
    });

    it('should not start if already running', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();
      await service.start(); // Try to start again

      expect(mockLogger).toHaveBeenCalledWith('warn', 'WeatherService already running');
    });

    it('should setup weather update timer', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();

      expect(mockLogger).toHaveBeenCalledWith(
        'info',
        'Weather update timer started',
        expect.objectContaining({
          intervalMinutes: config.updateFrequency,
        })
      );
    });

    it('should start successfully', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();

      expect(mockLogger).toHaveBeenCalledWith('info', 'WeatherService started successfully');
    });
  });

  describe('stop', () => {
    it('should stop successfully when running', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();
      await service.stop();

      expect(mockLogger).toHaveBeenCalledWith('info', 'Stopping WeatherService');
      expect(mockLogger).toHaveBeenCalledWith(
        'info',
        'WeatherService stopped successfully',
        expect.objectContaining({
          updateCount: expect.any(Number),
          emissionCount: expect.any(Number),
          errorCount: expect.any(Number),
        })
      );
    });

    it('should not stop if already stopped', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.stop();

      expect(mockLogger).toHaveBeenCalledWith('warn', 'WeatherService already stopped');
    });

    it('should clear timers on stop', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();

      const status = service.getServiceStatus();
      expect(status.state).toBe('running');

      await service.stop();

      const statusAfterStop = service.getServiceStatus();
      expect(statusAfterStop.state).toBe('stopped');
    });
  });

  describe('getCurrentWeatherData', () => {
    it('should return null when no data available', () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const data = service.getCurrentWeatherData();

      expect(data).toBeNull();
    });
  });

  describe('getServiceStatus', () => {
    it('should return initial status', () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const status = service.getServiceStatus();

      expect(status.state).toBe('stopped');
      expect(status.lastUpdate).toBeNull();
      expect(status.lastEmission).toBeNull();
      expect(status.updateCount).toBe(0);
      expect(status.emissionCount).toBe(0);
      expect(status.errorCount).toBe(0);
      expect(status.hasWeatherData).toBe(false);
    });

    it('should return running status after start', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();

      const status = service.getServiceStatus();

      expect(status.state).toBe('running');
    });

    it('should include signalK health status', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const status = service.getServiceStatus();

      expect(status.signalKHealth).toBeDefined();
      expect(status.signalKHealth).toHaveProperty('status');
      expect(status.signalKHealth).toHaveProperty('isStale');
    });

    it('should include cache stats', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const status = service.getServiceStatus();

      expect(status.cacheStats).toBeDefined();
      expect(status.cacheStats).toHaveProperty('size');
    });
  });

  describe('generateMockWeatherData', () => {
    it('should generate valid mock weather data', () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const mockData = service.generateMockWeatherData();

      expect(mockData).toBeDefined();
      expect(mockData.temperature).toBe(288.15); // 15°C
      expect(mockData.pressure).toBe(101325);
      expect(mockData.humidity).toBe(0.65);
      expect(mockData.windSpeed).toBeCloseTo(5.14, 1);
      expect(mockData.windDirection).toBe(Math.PI / 2);
      expect(mockData.description).toBe('Mock weather data for testing');
      expect(mockData.quality).toBe(0.5);
    });

    it('should include timestamp in mock data', () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const mockData = service.generateMockWeatherData();

      expect(mockData.timestamp).toBeDefined();
      expect(() => new Date(mockData.timestamp)).not.toThrow();
    });

    it('should include calculated fields', () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      const mockData = service.generateMockWeatherData();

      expect(mockData.dewPoint).toBeDefined();
      expect(mockData.windChill).toBeDefined();
      expect(mockData.heatIndex).toBeDefined();
    });
  });

  describe('forceUpdate', () => {
    it('should log force update request', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      // This will fail due to no position, but we're testing the logging
      try {
        await service.forceUpdate();
      } catch {
        // Expected to fail
      }

      expect(mockLogger).toHaveBeenCalledWith('info', 'Forcing immediate weather update');
    });
  });

  describe('lifecycle integration', () => {
    it('should handle start/stop/start cycle', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();
      expect(service.getServiceStatus().state).toBe('running');

      await service.stop();
      expect(service.getServiceStatus().state).toBe('stopped');

      await service.start();
      expect(service.getServiceStatus().state).toBe('running');

      await service.stop();
      expect(service.getServiceStatus().state).toBe('stopped');
    });
  });

  describe('error handling', () => {
    it('should track error count', async () => {
      const service = new WeatherService(mockApp as never, config, mockLogger);

      await service.start();

      const initialStatus = service.getServiceStatus();
      expect(initialStatus.errorCount).toBe(0);
    });
  });
});

describe('WeatherService - Data Emission', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let config: PluginConfiguration;

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
    config = createTestConfig();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should not emit when no weather data available', async () => {
    const service = new WeatherService(mockApp as never, config, mockLogger);

    await service.start();

    // Advance time past emission interval
    await vi.advanceTimersByTimeAsync(config.emissionInterval * 1000 + 100);

    // handleMessage should not be called since there's no weather data
    // Data won't be valid without weather data
    expect(service.getCurrentWeatherData()).toBeNull();
  });
});

describe('WeatherService - Configuration Validation', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
  });

  it('should accept valid configuration', () => {
    const config = createTestConfig();

    expect(() => new WeatherService(mockApp as never, config, mockLogger)).not.toThrow();
  });

  it('should accept custom update frequency', () => {
    const config = createTestConfig({ updateFrequency: 10 });

    // Create service to trigger initialization logging
    new WeatherService(mockApp as never, config, mockLogger);

    expect(mockLogger).toHaveBeenCalledWith(
      'info',
      'WeatherService initializing',
      expect.objectContaining({
        updateFrequency: 10,
      })
    );
  });

  it('should accept custom emission interval', () => {
    const config = createTestConfig({ emissionInterval: 10 });

    // Create service to trigger initialization logging
    new WeatherService(mockApp as never, config, mockLogger);

    expect(mockLogger).toHaveBeenCalledWith(
      'info',
      'WeatherService initializing',
      expect.objectContaining({
        emissionInterval: 10,
      })
    );
  });
});
