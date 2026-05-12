/**
 * Unit tests for WeatherNotifier.
 *
 * Covers the transition state machine: entry / exit edges, no leading
 * `normal` on the first evaluation, idempotent re-evaluation of an unchanged
 * snapshot, master / per-category toggles, and the WeatherIcon severity
 * mapping for the dedicated severe-condition path.
 */

import { describe, expect, it } from 'vitest';
import { NOTIFICATION_PATHS } from '../../constants/index.js';
import { WeatherNotifier } from '../../notifications/WeatherNotifier.js';
import type { NotificationsConfig, NotificationValue, WeatherData } from '../../types/index.js';
import { createMockWeatherData } from '../setup.js';

const ALL_ENABLED: NotificationsConfig = {
  enabled: true,
  wind: true,
  visibility: true,
  heat: true,
  cold: true,
  weather: true,
};

function makeNotifier(overrides: Partial<NotificationsConfig> = {}): WeatherNotifier {
  return new WeatherNotifier({ ...ALL_ENABLED, ...overrides });
}

/** Convenience: build a WeatherData snapshot with the helpers below. */
function snapshot(extras: Partial<WeatherData>): WeatherData {
  return createMockWeatherData({ ...extras });
}

/** Pull the value object out of a notification PathValue for shape assertions. */
function readValue(pv: { value: unknown }): NotificationValue {
  return pv.value as NotificationValue;
}

describe('WeatherNotifier: master enable', () => {
  it('emits nothing when notifications.enabled is false', () => {
    const notifier = makeNotifier({ enabled: false });
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    expect(out).toEqual([]);
  });

  it('emits when notifications.enabled is true and a band is active', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('WeatherNotifier: wind bands', () => {
  it('does not emit a leading normal for a band that has never been active', () => {
    // Beaufort 5 is below the gale threshold (8). Without a prior `warn`, we
    // should not emit a `normal` clear; the bus already lacks the path.
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ beaufortScale: 5 }));
    expect(out).toEqual([]);
  });

  it('emits warn on entry into gale, alarm into storm, emergency into hurricane', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.WIND_GALE)?.state).toBe('warn');
    expect(paths.get(NOTIFICATION_PATHS.WIND_STORM)?.state).toBe('alarm');
    expect(paths.get(NOTIFICATION_PATHS.WIND_HURRICANE)?.state).toBe('emergency');
  });

  it('emits normal on exit from each active band, exactly once per transition', () => {
    const notifier = makeNotifier();
    // Step 1: hurricane fires all three.
    notifier.evaluate(snapshot({ beaufortScale: 12 }));
    // Step 2: wind drops below every threshold.
    const out = notifier.evaluate(snapshot({ beaufortScale: 5 }));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.WIND_GALE)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.WIND_STORM)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.WIND_HURRICANE)?.state).toBe('normal');
  });

  it('is idempotent: a repeated active snapshot emits no further transitions', () => {
    const notifier = makeNotifier();
    notifier.evaluate(snapshot({ beaufortScale: 12 }));
    // Re-evaluate the same Beaufort: nothing transitioned.
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    expect(out).toEqual([]);
  });

  it('skips wind evaluation when beaufortScale is undefined', () => {
    const data = createMockWeatherData();
    // beaufortScale is not set in the mock by default.
    expect(data.beaufortScale).toBeUndefined();
    const notifier = makeNotifier();
    const out = notifier.evaluate(data);
    // No wind paths should appear in the output.
    expect(out.find((pv) => pv.path.startsWith('notifications.environment.wind.'))).toBeUndefined();
  });
});

describe('WeatherNotifier: visibility', () => {
  it('fires both low and veryLow when visibility drops below 0.5 nm', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ visibility: 500 }));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.VISIBILITY_LOW)?.state).toBe('warn');
    expect(paths.get(NOTIFICATION_PATHS.VISIBILITY_VERY_LOW)?.state).toBe('alarm');
  });

  it('fires only low when visibility is between 0.5 and 1 nm', () => {
    const notifier = makeNotifier();
    // 1000m is below the LOW_M threshold (1852m) but above VERY_LOW_M (926m).
    const out = notifier.evaluate(snapshot({ visibility: 1000 }));
    const paths = out.map((pv) => pv.path);
    expect(paths).toContain(NOTIFICATION_PATHS.VISIBILITY_LOW);
    expect(paths).not.toContain(NOTIFICATION_PATHS.VISIBILITY_VERY_LOW);
  });
});

describe('WeatherNotifier: heat and cold', () => {
  it('fires caution, high, and extreme heat at HSI 4', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ heatStressIndex: 4 }));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.HEAT_CAUTION)?.state).toBe('warn');
    expect(paths.get(NOTIFICATION_PATHS.HEAT_HIGH)?.state).toBe('alarm');
    expect(paths.get(NOTIFICATION_PATHS.HEAT_EXTREME)?.state).toBe('emergency');
  });

  it('fires both cold bands when wind chill is below -20 C', () => {
    const notifier = makeNotifier();
    // -25 C in Kelvin
    const out = notifier.evaluate(snapshot({ windChill: 248.15 }));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.COLD_CAUTION)?.state).toBe('warn');
    expect(paths.get(NOTIFICATION_PATHS.COLD_EXTREME)?.state).toBe('alarm');
  });
});

describe('WeatherNotifier: severe condition (WeatherIcon)', () => {
  it('maps icon 15 (thunderstorms) to warn with the description in the message', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({ weatherIcon: 15, description: 'Severe thunderstorms approaching' })
    );
    const pv = out.find((p) => p.path === NOTIFICATION_PATHS.WEATHER_SEVERE);
    expect(pv).toBeDefined();
    if (!pv) throw new Error('expected severe notification');
    const value = readValue(pv);
    expect(value.state).toBe('warn');
    expect(value.message).toContain('Thunderstorms');
    expect(value.message).toContain('Severe thunderstorms approaching');
  });

  it('maps icon 24 (ice) to alarm', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ weatherIcon: 24, description: 'Ice' }));
    const pv = out.find((p) => p.path === NOTIFICATION_PATHS.WEATHER_SEVERE);
    expect(pv && readValue(pv).state).toBe('alarm');
  });

  it('emits normal exit when icon falls outside the severity table', () => {
    const notifier = makeNotifier();
    notifier.evaluate(snapshot({ weatherIcon: 15, description: 'Thunderstorms' }));
    const out = notifier.evaluate(snapshot({ weatherIcon: 1, description: 'Sunny' }));
    const pv = out.find((p) => p.path === NOTIFICATION_PATHS.WEATHER_SEVERE);
    expect(pv && readValue(pv).state).toBe('normal');
  });
});

describe('WeatherNotifier: per-category toggles', () => {
  it('does not emit wind notifications when wind is disabled', () => {
    const notifier = makeNotifier({ wind: false });
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    expect(out.find((pv) => pv.path.startsWith('notifications.environment.wind.'))).toBeUndefined();
  });

  it('still emits other categories when only wind is disabled', () => {
    const notifier = makeNotifier({ wind: false });
    const out = notifier.evaluate(
      snapshot({ beaufortScale: 12, visibility: 500, heatStressIndex: 4 })
    );
    const paths = out.map((pv) => pv.path);
    expect(paths).not.toContain(NOTIFICATION_PATHS.WIND_GALE);
    expect(paths).toContain(NOTIFICATION_PATHS.VISIBILITY_LOW);
    expect(paths).toContain(NOTIFICATION_PATHS.HEAT_EXTREME);
  });
});

describe('WeatherNotifier: value shape', () => {
  it('emits the SK spec shape (state, method, message, timestamp)', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    const pv = out[0];
    if (!pv) throw new Error('expected at least one transition');
    const value = readValue(pv);
    expect(value.state).toBeDefined();
    expect(Array.isArray(value.method)).toBe(true);
    expect(typeof value.message).toBe('string');
    expect(typeof value.timestamp).toBe('string');
    // Timestamp parses as an ISO string.
    expect(Number.isFinite(new Date(value.timestamp).getTime())).toBe(true);
  });

  it('attaches sound + visual on alarm and emergency, visual-only on warn', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    const gale = out.find((p) => p.path === NOTIFICATION_PATHS.WIND_GALE);
    const storm = out.find((p) => p.path === NOTIFICATION_PATHS.WIND_STORM);
    const hurr = out.find((p) => p.path === NOTIFICATION_PATHS.WIND_HURRICANE);
    if (!gale || !storm || !hurr) throw new Error('expected all three wind bands to fire');
    expect(readValue(gale).method).toEqual(['visual']);
    expect(readValue(storm).method).toEqual(['visual', 'sound']);
    expect(readValue(hurr).method).toEqual(['visual', 'sound']);
  });
});

describe('WeatherNotifier: reset', () => {
  it('clears tracked state so subsequent evaluations are first-time again', () => {
    const notifier = makeNotifier();
    notifier.evaluate(snapshot({ beaufortScale: 12 })); // arms all wind bands
    notifier.reset();
    // After reset, repeating the same active snapshot is treated as a fresh
    // entry: bands fire again, no leading normals.
    const out = notifier.evaluate(snapshot({ beaufortScale: 12 }));
    expect(out.length).toBeGreaterThan(0);
    for (const pv of out) {
      expect(readValue(pv).state).not.toBe('normal');
    }
  });
});
