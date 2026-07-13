/**
 * WeatherService Tests
 * Comprehensive tests for the main weather orchestration service
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindCalculator } from '../../calculators/WindCalculator.js';
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

// Mock logger: callers cast to the expected signature at the use site if
// needed. `vi.fn()` is already callable, so no double cast is required here.
const createMockLogger = () => vi.fn();

// Default test configuration
const createTestConfig = (overrides?: Partial<PluginConfiguration>): PluginConfiguration => ({
  accuWeatherApiKey: 'test-api-key-12345678',
  weatherProvider: 'open-meteo',
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
        calculateWindAnalysis: vi
          .fn()
          .mockReturnValue({ apparentWindSpeed: 5, apparentWindAngle: 0.5, isValid: true }),
        normalizeAngle: vi.fn().mockReturnValue(0),
      };

      const service = new WeatherService(mockApp as never, config, mockLogger, {
        windCalculator: mockWindCalculator as never,
      });

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

  it('derives apparent wind chill from the apparent wind speed', async () => {
    const weatherData = {
      temperature: 268.15, // -5 C, cold enough for a meaningful wind chill
      pressure: 101325,
      humidity: 0.7,
      windSpeed: 12,
      windDirection: Math.PI / 2,
      dewPoint: 264.15,
      windChill: 262.15,
      heatIndex: 268.15,
      timestamp: new Date().toISOString(),
    };
    const vesselData = {
      position: { latitude: 60, longitude: 5 },
      speedOverGround: 5,
      courseOverGroundTrue: 0,
      isComplete: true,
    };
    const mockAccu = {
      fetchCurrentWeather: vi.fn().mockResolvedValue(weatherData),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
    };
    const mockSignalK = {
      getVesselNavigationData: vi.fn(() => vesselData),
      clearCache: vi.fn(),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockAccu as never,
      signalKService: mockSignalK as never,
    });

    // The service must be running for updateWeatherData to keep its result.
    await service.start();
    await service.forceUpdate();

    const data = service.getCurrentWeatherData();
    expect(data?.apparentWindSpeed).toBeDefined();
    // apparentWindChill is wind chill recomputed against the apparent wind the
    // moving vessel experiences, distinct from the theoretical windChill.
    const expected = new WindCalculator().calculateWindChill(
      weatherData.temperature,
      data?.apparentWindSpeed as number
    );
    expect(data?.apparentWindChill).toBeCloseTo(expected, 5);

    await service.stop();
  });

  it('fetches marine data alongside weather when a marine service is provided', async () => {
    const weatherData = {
      temperature: 293.15,
      pressure: 101325,
      humidity: 0.6,
      windSpeed: 5,
      windDirection: Math.PI,
      dewPoint: 285.15,
      windChill: 293.15,
      heatIndex: 293.15,
      timestamp: new Date().toISOString(),
    };
    const vesselData = { position: { latitude: 60, longitude: 5 }, isComplete: false };
    const marine = { timestamp: 't', significantWaveHeight: 1.2, seaSurfaceTemperature: 287.15 };
    const mockProvider = {
      fetchCurrentWeather: vi.fn().mockResolvedValue(weatherData),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
    };
    const mockSignalK = { getVesselNavigationData: vi.fn(() => vesselData), clearCache: vi.fn() };
    const mockMarine = { fetchMarine: vi.fn().mockResolvedValue(marine) };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: mockSignalK as never,
      marineService: mockMarine as never,
    });

    await service.start();
    await service.forceUpdate();

    expect(mockMarine.fetchMarine).toHaveBeenCalledWith(vesselData.position);
    expect(service.getCurrentMarineData()?.significantWaveHeight).toBe(1.2);

    await service.stop();
  });

  it('keeps the weather update when the marine fetch fails (best-effort)', async () => {
    const weatherData = {
      temperature: 293.15,
      pressure: 101325,
      humidity: 0.6,
      windSpeed: 5,
      windDirection: Math.PI,
      dewPoint: 285.15,
      windChill: 293.15,
      heatIndex: 293.15,
      timestamp: new Date().toISOString(),
    };
    const vesselData = { position: { latitude: 60, longitude: 5 }, isComplete: false };
    const mockProvider = {
      fetchCurrentWeather: vi.fn().mockResolvedValue(weatherData),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
    };
    const mockSignalK = { getVesselNavigationData: vi.fn(() => vesselData), clearCache: vi.fn() };
    const mockMarine = { fetchMarine: vi.fn().mockRejectedValue(new Error('marine host down')) };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: mockSignalK as never,
      marineService: mockMarine as never,
    });

    await service.start();
    await service.forceUpdate();

    expect(service.getCurrentWeatherData()).not.toBeNull();
    expect(service.getCurrentMarineData()).toBeNull();

    await service.stop();
  });

  it('coalesces overlapping updates into a single fetch (single-flight)', async () => {
    const weatherData = {
      temperature: 293.15,
      pressure: 101325,
      humidity: 0.6,
      windSpeed: 5,
      windDirection: Math.PI,
      dewPoint: 285.15,
      windChill: 293.15,
      heatIndex: 293.15,
      timestamp: new Date().toISOString(),
    };
    let resolveFetch: ((data: typeof weatherData) => void) | undefined;
    const mockAccu = {
      fetchCurrentWeather: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      ),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };
    const mockSignalK = {
      getVesselNavigationData: vi.fn(() => ({
        position: { latitude: 60, longitude: 5 },
        isComplete: false,
      })),
      getHealthStatus: vi.fn(() => ({ status: 'ok', isStale: false })),
      clearCache: vi.fn(),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockAccu as never,
      signalKService: mockSignalK as never,
    });
    await service.start();

    // Two updates racing: the second must join the first fetch, not start a
    // second one (a second fetch would double-spend API quota).
    const first = service.forceUpdate();
    const second = service.forceUpdate();
    expect(mockAccu.fetchCurrentWeather).toHaveBeenCalledTimes(1);

    resolveFetch?.(weatherData);
    await Promise.all([first, second]);

    expect(mockAccu.fetchCurrentWeather).toHaveBeenCalledTimes(1);
    expect(service.getServiceStatus().updateCount).toBe(1);

    // A fresh update after the in-flight one settled fetches again.
    const third = service.forceUpdate();
    expect(mockAccu.fetchCurrentWeather).toHaveBeenCalledTimes(2);
    resolveFetch?.(weatherData);
    await third;

    await service.stop();
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
      name: 'AccuWeather',
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
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(40),
    });

    const banner = service.formatStatusBanner();
    expect(banner).toBe('Running, awaiting first update');
    expect(banner).not.toContain('today');
  });

  it('appends ", K/Q today" with the running prefix at 50% usage', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(25),
    });

    const banner = service.formatStatusBanner();
    expect(banner).toContain('Running');
    expect(banner).not.toContain('quota 90% used');
    expect(banner).toContain('25/50 today');
  });

  it('switches to the quota-warning prefix at 90% usage', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(45),
    });

    const banner = service.formatStatusBanner();
    expect(banner).toContain('Running [quota 90% used]');
    expect(banner).toContain('45/50 today');
    expect(service.isQuotaExhausted()).toBe(false);
  });

  it('flags exhaustion at 100% usage and keeps the warning prefix', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(50),
    });

    const banner = service.formatStatusBanner();
    expect(banner).toContain('Running [quota 90% used]');
    expect(banner).toContain('50/50 today');
    expect(service.isQuotaExhausted()).toBe(true);
  });

  it('formats the quota-exhausted message with actionable guidance', () => {
    const config = createTestConfig({ dailyApiQuota: 50 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(50),
    });

    const message = service.formatQuotaExhaustedMessage();
    expect(message).toContain('AccuWeather daily quota reached (50/50 in last 24h)');
    expect(message).toContain('Fetches paused');
    // Operators need to know HOW to resume.
    expect(message).toMatch(/raise dailyApiQuota|increase updateFrequency/);
  });
});

describe('WeatherService - Tick Banner and Staleness', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  /** Stand-in AccuWeatherService that pins both counters; see Quota Banner block. */
  const makeFakeAccu = (last24h: number, cumulative = last24h) =>
    ({
      name: 'AccuWeather',
      getRequestCount: () => cumulative,
      getRequestCountLast24h: () => last24h,
      getCacheStats: () => ({ size: 0 }),
    }) as unknown as import('../../services/AccuWeatherService.js').AccuWeatherService;

  /** Pin the last successful fetch `ageMinutes` in the past without a real fetch. */
  const pinLastUpdate = (service: WeatherService, ageMinutes: number): void => {
    (service as unknown as { lastUpdate: Date }).lastUpdate = new Date(
      Date.now() - ageMinutes * 60_000
    );
  };

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
  });

  it('isDataStale is false before the first fetch and inside the staleness window', () => {
    // updateFrequency 5 min, STALENESS_FACTOR 2: stale past 10 minutes.
    const config = createTestConfig({ updateFrequency: 5, dailyApiQuota: 0 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(0),
    });

    expect(service.isDataStale()).toBe(false);

    pinLastUpdate(service, 5);
    expect(service.isDataStale()).toBe(false);

    pinLastUpdate(service, 15);
    expect(service.isDataStale()).toBe(true);
  });

  it('returns the live status banner while data is fresh and quota has headroom', () => {
    const config = createTestConfig({ updateFrequency: 5, dailyApiQuota: 50 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(10),
    });
    pinLastUpdate(service, 1);

    const banner = service.getTickBanner();
    expect(banner.kind).toBe('status');
    expect(banner.message).toContain('Running');
  });

  it('returns the stale-data error once age crosses the staleness window', () => {
    const config = createTestConfig({ updateFrequency: 5, dailyApiQuota: 0 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(0),
    });
    pinLastUpdate(service, 15);

    const banner = service.getTickBanner();
    expect(banner.kind).toBe('error');
    expect(banner.message).toBe('Weather data stale: last update 15 minutes ago');
  });

  it('uses singular "minute" at the one-minute stale boundary', () => {
    // updateFrequency 0.5 min keeps the threshold (1 minute) below the pinned
    // 1.5-minute age so the stale branch fires with a floored age of 1.
    const config = createTestConfig({ updateFrequency: 0.5, dailyApiQuota: 0 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(0),
    });
    pinLastUpdate(service, 1.5);

    expect(service.getTickBanner().message).toBe('Weather data stale: last update 1 minute ago');
  });

  it('prefers the quota-exhausted error over the stale-data error', () => {
    const config = createTestConfig({ updateFrequency: 5, dailyApiQuota: 50 });
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(50),
    });
    // Stale too: the quota message must win because it explains WHY fetches paused.
    pinLastUpdate(service, 15);

    const banner = service.getTickBanner();
    expect(banner.kind).toBe('error');
    expect(banner.message).toContain('AccuWeather daily quota reached');
    expect(banner.message).not.toContain('stale');
    // Staleness still gates emission independently of the banner choice.
    expect(service.isDataStale()).toBe(true);
  });
});

describe('WeatherService - Banner Pluralization', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  /** Stand-in AccuWeatherService that pins both counters; see Quota Banner block. */
  const makeFakeAccu = (last24h: number, cumulative = last24h) =>
    ({
      name: 'AccuWeather',
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
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(0, 1),
    });

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
    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: makeFakeAccu(0, 3),
    });

    (service as unknown as { updateCount: number }).updateCount = 3;
    (service as unknown as { lastUpdate: Date }).lastUpdate = new Date();

    const banner = service.formatStatusBanner();
    expect(banner).toContain('3 updates');
    expect(banner).toContain('3 API requests');
  });
});

describe('WeatherService - Fetch Skip and Error Escalation', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let bannerCalls: Array<{ kind: 'status' | 'error'; message: string }>;
  let setBanner: (kind: 'status' | 'error', message: string) => void;

  // Steady cold weather payload reused across the failure/recovery cases.
  const weatherData = {
    temperature: 293.15,
    pressure: 101325,
    humidity: 0.6,
    windSpeed: 5,
    windDirection: Math.PI,
    dewPoint: 285.15,
    windChill: 293.15,
    heatIndex: 293.15,
    timestamp: new Date().toISOString(),
  };

  const inlandVessel = { position: { latitude: 60, longitude: 5 }, isComplete: false };

  const makeSignalK = (vesselData: unknown = inlandVessel) => ({
    getVesselNavigationData: vi.fn(() => vesselData),
    getHealthStatus: vi.fn(() => ({ status: 'ok', isStale: false })),
    clearCache: vi.fn(),
  });

  beforeEach(() => {
    mockApp = createMockApp();
    mockLogger = createMockLogger();
    bannerCalls = [];
    setBanner = (kind, message) => {
      bannerCalls.push({ kind, message });
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips the fetch entirely when the daily quota is exhausted', async () => {
    // Provider reports last24h === dailyApiQuota, so isQuotaExhausted() is true.
    const config = createTestConfig({ dailyApiQuota: 50 });
    const mockProvider = {
      name: 'AccuWeather',
      fetchCurrentWeather: vi.fn().mockResolvedValue(weatherData),
      getRequestCount: vi.fn(() => 50),
      getRequestCountLast24h: vi.fn(() => 50),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: makeSignalK() as never,
      setBanner,
    });

    await service.forceUpdate();

    // The fetch is short-circuited before any provider call.
    expect(mockProvider.fetchCurrentWeather).not.toHaveBeenCalled();
    // An error banner carrying the quota wording is published via the sink.
    const errorBanners = bannerCalls.filter((b) => b.kind === 'error');
    expect(errorBanners).toHaveLength(1);
    expect(errorBanners[0].message).toContain(
      'AccuWeather daily quota reached (50/50 in last 24h)'
    );
  });

  it('escalates a 401 to apiKeyRejected, clears the timer, and refuses subsequent fetches', async () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    const mockProvider = {
      name: 'AccuWeather',
      // Error message carries the API_UNAUTHORIZED tag isAuthError() looks for.
      fetchCurrentWeather: vi
        .fn()
        .mockRejectedValue(new Error('AccuWeather request failed: API_UNAUTHORIZED (401)')),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: makeSignalK() as never,
      setBanner,
    });

    await service.start();
    // The update timer is live after start(); the 401 escalation must clear it.
    expect((service as unknown as { updateTimer: unknown }).updateTimer).not.toBeNull();

    await expect(service.forceUpdate()).rejects.toThrow();

    expect(service.isApiKeyRejected()).toBe(true);
    expect(service.formatStatusBanner()).toBe('API key rejected: update key in plugin settings');
    expect((service as unknown as { updateTimer: unknown }).updateTimer).toBeNull();

    const authBanner = bannerCalls.find((b) =>
      b.message.includes('AccuWeather rejected the configured API key')
    );
    expect(authBanner?.kind).toBe('error');

    // A second forceUpdate must early-return without touching the provider again.
    expect(mockProvider.fetchCurrentWeather).toHaveBeenCalledTimes(1);
    await service.forceUpdate();
    expect(mockProvider.fetchCurrentWeather).toHaveBeenCalledTimes(1);

    await service.stop();
  });

  it('appends "(2 consecutive)" on the second non-auth failure and resets the streak on success', async () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    let mode: 'fail' | 'succeed' = 'fail';
    const mockProvider = {
      fetchCurrentWeather: vi.fn(() =>
        mode === 'fail'
          ? Promise.reject(new Error('network timeout'))
          : Promise.resolve(weatherData)
      ),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: makeSignalK() as never,
      setBanner,
    });

    await service.start();

    // First failure: no "(N consecutive)" suffix (streak is 1).
    await expect(service.forceUpdate()).rejects.toThrow();
    expect(bannerCalls.at(-1)?.message).toBe('Weather update failed: network timeout');
    expect(bannerCalls.at(-1)?.message).not.toContain('consecutive');

    // Second consecutive failure: suffix appears.
    await expect(service.forceUpdate()).rejects.toThrow();
    expect(bannerCalls.at(-1)?.message).toBe(
      'Weather update failed (2 consecutive): network timeout'
    );

    // A success resets the streak.
    mode = 'succeed';
    await service.forceUpdate();

    // The next failure shows no suffix again (streak back to 1).
    mode = 'fail';
    await expect(service.forceUpdate()).rejects.toThrow();
    expect(bannerCalls.at(-1)?.message).toBe('Weather update failed: network timeout');
    expect(bannerCalls.at(-1)?.message).not.toContain('consecutive');

    await service.stop();
  });

  it('discards a weather result that resolves after stop() (torn-down service guard)', async () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    let resolveFetch: ((data: typeof weatherData) => void) | undefined;
    const mockProvider = {
      fetchCurrentWeather: vi.fn(
        () =>
          new Promise<typeof weatherData>((resolve) => {
            resolveFetch = resolve;
          })
      ),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: makeSignalK() as never,
      setBanner,
    });

    await service.start();
    const updatePromise = service.forceUpdate();
    // Stop BEFORE the in-flight fetch resolves.
    await service.stop();

    resolveFetch?.(weatherData);
    await updatePromise;

    // The post-fetch writes are discarded: no data, no update increment.
    expect(service.getCurrentWeatherData()).toBeNull();
    expect(service.getServiceStatus().updateCount).toBe(0);
  });

  it('omits apparent wind when SOG, COG, and heading are absent', async () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    // Position only: no speedOverGround, courseOverGroundTrue, or headingTrue.
    const positionOnlyVessel = {
      position: { latitude: 60, longitude: 5 },
      isComplete: false,
    };
    const mockProvider = {
      fetchCurrentWeather: vi.fn().mockResolvedValue(weatherData),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      weatherProvider: mockProvider as never,
      signalKService: makeSignalK(positionOnlyVessel) as never,
      setBanner,
    });

    await service.start();
    await service.forceUpdate();

    const data = service.getCurrentWeatherData();
    expect(data?.apparentWindAngle).toBeUndefined();
    expect(data?.apparentWindSpeed).toBeUndefined();
    expect(data?.apparentWindChill).toBeUndefined();

    await service.stop();
  });

  it('routes through the fallback when calculateWindAnalysis returns isValid: false', async () => {
    const config = createTestConfig({ dailyApiQuota: 0 });
    // Complete vessel data so the complete-data branch runs, but the injected
    // calculator flags the analysis invalid, forcing the heading fallback.
    const completeVessel = {
      position: { latitude: 60, longitude: 5 },
      speedOverGround: 5,
      courseOverGroundTrue: 0,
      headingTrue: 0,
      isComplete: true,
    };
    const mockWindCalculator = {
      calculateWindAnalysis: vi.fn().mockReturnValue({ isValid: false, validationErrors: ['bad'] }),
      // Fallback path uses normalizeAngle on (windDirection - heading).
      normalizeAngle: vi.fn((a: number) => a),
      calculateWindChill: vi.fn(() => weatherData.temperature),
    };
    const mockProvider = {
      fetchCurrentWeather: vi.fn().mockResolvedValue(weatherData),
      getRequestCount: vi.fn(() => 1),
      getRequestCountLast24h: vi.fn(() => 1),
      getCacheStats: vi.fn(() => ({ size: 0 })),
    };

    const service = new WeatherService(mockApp as never, config, mockLogger, {
      windCalculator: mockWindCalculator as never,
      weatherProvider: mockProvider as never,
      signalKService: makeSignalK(completeVessel) as never,
      setBanner,
    });

    await service.start();
    await service.forceUpdate();

    expect(mockWindCalculator.calculateWindAnalysis).toHaveBeenCalledTimes(1);
    const data = service.getCurrentWeatherData();
    expect(data?.apparentWindSpeed).toBeUndefined();
    expect(data?.apparentWindAngle).toBeUndefined();
    expect(data?.apparentWindChill).toBeUndefined();

    await service.stop();
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
