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
import { MAX_MESSAGE_LENGTH, WeatherNotifier } from '../../notifications/WeatherNotifier.js';
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

describe('WeatherNotifier: enriched messages', () => {
  it('wind: surfaces Beaufort, cardinal direction, sustained speed, gusts, and pressure', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        beaufortScale: 9,
        windSpeed: 19,
        windGustSpeed: 27,
        windDirection: (5 * Math.PI) / 4, // 225 deg = SW
        pressure: 99800, // 998 hPa
      })
    );
    const gale = out.find((pv) => pv.path === NOTIFICATION_PATHS.WIND_GALE);
    if (!gale) throw new Error('expected gale to fire at Beaufort 9');
    const msg = readValue(gale).message;
    expect(msg).toContain('Gale-force wind:');
    expect(msg).toContain('Bf9');
    expect(msg).toContain('SW');
    expect(msg).toContain('19 m/s');
    expect(msg).toContain('gusts 27 m/s');
    expect(msg).toContain('998 hPa');
  });

  it('wind: omits gust segment when gust is missing or not above sustained', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        beaufortScale: 9,
        windSpeed: 19,
        // No windGustSpeed
        pressure: 101325,
      })
    );
    const gale = out.find((pv) => pv.path === NOTIFICATION_PATHS.WIND_GALE);
    if (!gale) throw new Error('expected gale to fire');
    expect(readValue(gale).message).not.toContain('gusts');
  });

  it('visibility: includes ceiling and precipitation rate when available', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        visibility: 800,
        cloudCeiling: 90,
        precipitationLastHour: 2.5, // mm in the past hour ≈ mm/h
      })
    );
    const low = out.find((pv) => pv.path === NOTIFICATION_PATHS.VISIBILITY_LOW);
    if (!low) throw new Error('expected visibility.low to fire');
    const msg = readValue(low).message;
    expect(msg).toContain('Reduced visibility:');
    expect(msg).toContain('0.8 km');
    expect(msg).toContain('ceiling 90 m');
    expect(msg).toContain('rain 2.5 mm/h');
  });

  it('heat: surfaces HSI, WBGT in C, humidity percent, and RealFeel-in-shade', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        heatStressIndex: 3,
        wetBulbGlobeTemperature: 305.15, // 32 C
        humidity: 0.78,
        realFeelShade: 308.15, // 35 C
      })
    );
    const high = out.find((pv) => pv.path === NOTIFICATION_PATHS.HEAT_HIGH);
    if (!high) throw new Error('expected heat.high to fire at HSI 3');
    const msg = readValue(high).message;
    expect(msg).toContain('High heat stress:');
    expect(msg).toContain('HSI 3');
    expect(msg).toContain('WBGT 32 C');
    expect(msg).toContain('RH 78%');
    expect(msg).toContain('RealFeel 35 C');
  });

  it('cold: includes air temperature and wind speed alongside wind chill', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        windChill: 271.15, // -2 C
        temperature: 274.15, // +1 C
        windSpeed: 12,
      })
    );
    const cold = out.find((pv) => pv.path === NOTIFICATION_PATHS.COLD_CAUTION);
    if (!cold) throw new Error('expected cold.caution to fire');
    const msg = readValue(cold).message;
    expect(msg).toContain('Cold exposure caution:');
    expect(msg).toContain('wind chill -2 C');
    expect(msg).toContain('air 1 C');
    expect(msg).toContain('wind 12 m/s');
  });

  it('severe: appends barometric pressure when finite', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        weatherIcon: 15,
        description: 'Severe thunderstorms approaching',
        pressure: 99800,
      })
    );
    const severe = out.find((pv) => pv.path === NOTIFICATION_PATHS.WEATHER_SEVERE);
    if (!severe) throw new Error('expected severe to fire');
    const msg = readValue(severe).message;
    expect(msg).toContain('Thunderstorms:');
    expect(msg).toContain('998 hPa');
  });

  it('caps every emitted message at MAX_MESSAGE_LENGTH', () => {
    const notifier = makeNotifier();
    const out = notifier.evaluate(
      snapshot({
        beaufortScale: 12,
        windSpeed: 35,
        windGustSpeed: 65,
        windDirection: (5 * Math.PI) / 4,
        pressure: 92000,
        visibility: 400,
        cloudCeiling: 75,
        precipitationLastHour: 25,
        heatStressIndex: 4,
        wetBulbGlobeTemperature: 308.15,
        humidity: 0.95,
        realFeelShade: 313.15,
        windChill: 270.15,
        temperature: 273.15,
        weatherIcon: 24,
        description:
          'Ice with severe thunderstorms approaching from the southwest, hazardous conditions',
      })
    );
    expect(out.length).toBeGreaterThan(0);
    for (const transition of out) {
      expect(readValue(transition).message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('cardinal direction maps 0/π/2 radians correctly to N/E/S/W', () => {
    const notifier = makeNotifier();
    const cases: ReadonlyArray<readonly [number, string]> = [
      [0, 'from N'],
      [Math.PI / 2, 'from E'],
      [Math.PI, 'from S'],
      [(3 * Math.PI) / 2, 'from W'],
    ];
    for (const [radians, expected] of cases) {
      notifier.reset();
      const out = notifier.evaluate(snapshot({ beaufortScale: 9, windDirection: radians }));
      const gale = out.find((pv) => pv.path === NOTIFICATION_PATHS.WIND_GALE);
      if (!gale) throw new Error(`expected gale to fire for ${radians}`);
      expect(readValue(gale).message).toContain(expected);
    }
  });
});

describe('WeatherNotifier: driver field disappears', () => {
  it('heat: clears active bands to normal when heatStressIndex is absent from a later snapshot', () => {
    const notifier = makeNotifier();
    // Step 1: extreme heat stress fires all three heat bands.
    notifier.evaluate(snapshot({ heatStressIndex: 4 }));
    // Step 2: a partial AccuWeather response drops the wet-bulb-globe block,
    // so heatStressIndex is undefined. The bands must clear, not latch.
    const out = notifier.evaluate(snapshot({}));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.HEAT_CAUTION)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.HEAT_HIGH)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.HEAT_EXTREME)?.state).toBe('normal');
  });

  it('visibility: clears active bands to normal when visibility is absent from a later snapshot', () => {
    const notifier = makeNotifier();
    notifier.evaluate(snapshot({ visibility: 400 }));
    const out = notifier.evaluate(snapshot({}));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.VISIBILITY_LOW)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.VISIBILITY_VERY_LOW)?.state).toBe('normal');
  });

  it('wind: clears active bands to normal when beaufortScale is absent from a later snapshot', () => {
    const notifier = makeNotifier();
    notifier.evaluate(snapshot({ beaufortScale: 12 }));
    const out = notifier.evaluate(snapshot({}));
    const paths = new Map(out.map((pv) => [pv.path, readValue(pv)]));
    expect(paths.get(NOTIFICATION_PATHS.WIND_GALE)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.WIND_STORM)?.state).toBe('normal');
    expect(paths.get(NOTIFICATION_PATHS.WIND_HURRICANE)?.state).toBe('normal');
  });

  it('does not emit a leading normal when a driver field is absent from the first snapshot', () => {
    // No band has ever been active, so a missing driver must clear nothing.
    const notifier = makeNotifier();
    const out = notifier.evaluate(snapshot({}));
    expect(out).toEqual([]);
  });
});
