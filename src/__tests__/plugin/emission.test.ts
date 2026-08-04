import { describe, expect, it, vi } from 'vitest';
import { emitWeatherTick } from '../../plugin/emission.js';
import type { PluginInstance } from '../../plugin/instance.js';

describe('emitWeatherTick', () => {
  it('keeps emitting marine data while atmospheric mapping fails', () => {
    const weather = { temperature: 293.15 };
    const marine = { timestamp: '2026-08-04T12:00:00.000Z', significantWaveHeight: 1.2 };
    const marineDelta = {
      context: 'vessels.self',
      updates: [{ values: [{ path: 'environment.water.waves.significantHeight', value: 1.2 }] }],
    };
    const marineMeta = {
      context: 'vessels.self',
      updates: [{ meta: [{ path: 'environment.water.waves.significantHeight', value: {} }] }],
    };
    const instance = {
      weatherService: {
        getCurrentWeatherData: () => weather,
        getCurrentMarineData: () => marine,
        getTickBanner: () => ({ kind: 'status', message: 'Running' }),
        isDataStale: () => false,
        isMarineDataStale: () => false,
      },
      pathMapper: {
        mapToSignalKPaths: vi.fn(() => {
          throw new Error('mapper failed');
        }),
      },
      marinePathMapper: {
        mapToSignalKPaths: vi.fn(() => marineDelta),
        buildMetaDelta: vi.fn(() => marineMeta),
      },
      notifier: null,
      logger: Object.assign(vi.fn(), { redact: (value: string) => value }),
      cachedDelta: null,
      cachedWeatherDataRef: null,
      cachedMarineDelta: null,
      cachedMarineDataRef: null,
      marineMetaEmitted: false,
      metaEmitted: false,
      lastBanner: null,
    } as unknown as PluginInstance;
    const app = {
      handleMessage: vi.fn(),
      setPluginStatus: vi.fn(),
      setPluginError: vi.fn(),
    };

    emitWeatherTick(instance, app as never);
    emitWeatherTick(instance, app as never);

    expect(instance.pathMapper?.mapToSignalKPaths).toHaveBeenCalledTimes(1);
    expect(instance.marinePathMapper?.mapToSignalKPaths).toHaveBeenCalledTimes(1);
    expect(app.handleMessage).toHaveBeenCalledTimes(3);
    expect(app.handleMessage.mock.calls.filter((call) => call[1] === marineDelta)).toHaveLength(2);
  });
});
