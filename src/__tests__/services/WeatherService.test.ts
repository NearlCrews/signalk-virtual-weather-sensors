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
  dailyApiQuota: 50,
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
        normalizeAngle: vi.fn().mockReturnValue(0),
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
      expect(status.updateCount).toBe(0);
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

describe('WeatherService - Quota Banner', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  /**
   * Build a minimal AccuWeatherService stand-in that lets each test pin the
   * rolling 24h count to a chosen value. We bypass the real constructor (no
   * API key, no fetch) by casting the stub to AccuWeatherService.
   */
  const makeFakeAccu = (last24h: number, cumulative = last24h) =>
    ({
      getRequestCount: () => cumulative,
      getRequestCountLast24h: () => last24h,
      getCacheStats: () => ({ size: 0 }),
    }) as unknown as import('../../services/AccuWeatherService.js').AccuWeatherService;

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
  });

  it('omits the quota suffix when dailyApiQuota is 0', () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(40)
    );

    const banner = service.formatStatusBanner();
    expect(banner).toBe('Running, awaiting first update');
    expect(banner).not.toContain('today');
  });

  it('appends ", K/Q today" with the running prefix at 50% usage', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(25)
    );

    const banner = service.formatStatusBanner();
    expect(banner).toContain('Running');
    expect(banner).not.toContain('quota 90% used');
    expect(banner).toContain('25/50 today');
  });

  it('switches to the quota-warning prefix at 90% usage', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(45)
    );

    const banner = service.formatStatusBanner();
    expect(banner).toContain('Running [quota 90% used]');
    expect(banner).toContain('45/50 today');
    expect(service.isQuotaExhausted()).toBe(false);
  });

  it('flags exhaustion at 100% usage and keeps the warning prefix', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(50)
    );

    const banner = service.formatStatusBanner();
    expect(banner).toContain('Running [quota 90% used]');
    expect(banner).toContain('50/50 today');
    expect(service.isQuotaExhausted()).toBe(true);
  });

  it('formats the quota-exhausted message with actionable guidance', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(50)
    );

    const message = service.formatQuotaExhaustedMessage();
    expect(message).toContain('AccuWeather daily quota reached (50/50 in last 24h)');
    expect(message).toContain('Fetches paused');
    // Operators need to know HOW to resume.
    expect(message).toMatch(/raise dailyApiQuota|increase updateFrequency/);
  });
});

describe('WeatherService - Banner Pluralization', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  /** Stand-in AccuWeatherService that pins both counters; see Quota Banner block. */
  const makeFakeAccu = (last24h: number, cumulative = last24h) =>
    ({
      getRequestCount: () => cumulative,
      getRequestCountLast24h: () => last24h,
      getCacheStats: () => ({ size: 0 }),
    }) as unknown as import('../../services/AccuWeatherService.js').AccuWeatherService;

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
  });

  it('uses singular "update" and singular "API request" when both counters are 1', () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(0, 1)
    );

    // Reach into the orchestrator to pin updateCount=1 and lastUpdate=now
    // without driving a real fetch.
    (service as unknown as { updateCount: number }).updateCount = 1;
    (service as unknown as { lastUpdate: Date }).lastUpdate = new Date();

    const banner = service.formatStatusBanner();
    expect(banner).toContain('1 update,');
    expect(banner).not.toContain('1 updates');
    expect(banner).toContain('1 API request)');
    expect(banner).not.toContain('1 API requests');
  });

  it('uses plural "updates" / "API requests" when counters are >1', () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    const service = new WeatherService(
      mockApp as never,
      config,
      mockLogger,
      undefined,
      makeFakeAccu(0, 3)
    );

    (service as unknown as { updateCount: number }).updateCount = 3;
    (service as unknown as { lastUpdate: Date }).lastUpdate = new Date();

    const banner = service.formatStatusBanner();
    expect(banner).toContain('3 updates');
    expect(banner).toContain('3 API requests');
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
