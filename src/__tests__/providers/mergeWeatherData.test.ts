// src/__tests__/providers/mergeWeatherData.test.ts
import { describe, expect, it } from 'vitest';
import { FIELD_MERGE_KINDS, mergeWeatherData } from '../../providers/mergeWeatherData.js';
import type { WeatherData } from '../../types/index.js';
import { calculateHeatStressIndex } from '../../utils/conversions.js';

const base = (over: Partial<WeatherData>): WeatherData => ({
  temperature: 290,
  pressure: 101000,
  humidity: 0.5,
  windSpeed: 5,
  windDirection: 0,
  dewPoint: 283,
  windChill: 290,
  heatIndex: 290,
  timestamp: '2026-06-22T12:00:00Z',
  ...over,
});

describe('mergeWeatherData', () => {
  it('takes the scalar mean of present values', () => {
    const m = mergeWeatherData([base({ temperature: 290 }), base({ temperature: 300 })]);
    expect(m.temperature).toBeCloseTo(295, 5);
  });
  it('uses a speed-weighted circular mean for wind direction across the 0 wrap', () => {
    const m = mergeWeatherData([
      base({ windDirection: (350 * Math.PI) / 180, windSpeed: 5 }),
      base({ windDirection: (10 * Math.PI) / 180, windSpeed: 5 }),
    ]);
    // 350 and 10 degrees average to 0, not 180.
    expect(m.windDirection).toBeCloseTo(0, 4);
  });
  it('falls back to the priority direction when the resultant is near zero (opposing winds)', () => {
    const m = mergeWeatherData([
      base({ windDirection: 0, windSpeed: 5 }),
      base({ windDirection: Math.PI, windSpeed: 5 }),
    ]);
    expect(m.windDirection).toBeCloseTo(0, 6); // priority first-present
  });
  it('escalates severeCondition to the highest state (hazard-max)', () => {
    const m = mergeWeatherData([
      base({ severeCondition: { state: 'warn', label: 'Snow' } }),
      base({ severeCondition: { state: 'alarm', label: 'Thunderstorms' } }),
    ]);
    expect(m.severeCondition).toEqual({ state: 'alarm', label: 'Thunderstorms' });
  });
  it('takes hazard-max precipitation and gust, and hazard-min visibility', () => {
    const m = mergeWeatherData([
      base({ precipitationLastHour: 0, windGustSpeed: 10, visibility: 8000 }),
      base({ precipitationLastHour: 3, windGustSpeed: 20, visibility: 2000 }),
    ]);
    expect(m.precipitationLastHour).toBe(3);
    expect(m.windGustSpeed).toBe(20);
    expect(m.visibility).toBe(2000);
  });
  it('prefers a falling pressure tendency (conservative), and does not average tendencies', () => {
    expect(
      mergeWeatherData([base({ pressureTendency: 1 }), base({ pressureTendency: -1 })])
        .pressureTendency
    ).toBe(-1);
    expect(
      mergeWeatherData([base({ pressureTendency: 1 }), base({ pressureTendency: 0 })])
        .pressureTendency
    ).toBe(1); // priority first-present
  });
  it('takes WBGT and categorical fields from priority first-present, not averaged', () => {
    const m = mergeWeatherData([
      base({ wetBulbGlobeTemperature: 305, description: 'Clear', precipitationType: 'Rain' }),
      base({ wetBulbGlobeTemperature: 310, description: 'Cloudy' }),
    ]);
    expect(m.wetBulbGlobeTemperature).toBe(305); // primary, not the mean 307.5
    expect(m.description).toBe('Clear');
    expect(m.precipitationType).toBe('Rain');
  });
  it('publishes the WBGT of the highest-priority survivor that supplies one', () => {
    // A measured globe temperature and a shade estimate are different
    // quantities, so the published WBGT is priority-present, not a mean.
    const m = mergeWeatherData([
      base({ wetBulbGlobeTemperature: 305 }),
      base({ wetBulbGlobeTemperature: 300 }),
    ]);
    expect(m.wetBulbGlobeTemperature).toBe(305);
  });
  it('takes the highest survivor heat-stress index, not the primary one', () => {
    // Priority order chose the primary's WBGT, but the heat band is driven by
    // the index, and a sibling reporting more heat stress must not be dropped.
    const hot = base({ wetBulbGlobeTemperature: 306, heatStressIndex: 4 });
    const mild = base({ wetBulbGlobeTemperature: 300, heatStressIndex: 1 });
    expect(mergeWeatherData([mild, hot]).heatStressIndex).toBe(4);
    expect(mergeWeatherData([mild, hot]).wetBulbGlobeTemperature).toBe(300);
    expect(calculateHeatStressIndex(306)).toBe(4);
  });
  it('recomputes heat index and air density from the merged base, never averaging them', () => {
    const m = mergeWeatherData([
      base({ temperature: 290, windSpeed: 5, heatIndex: 999 }),
      base({ temperature: 300, windSpeed: 15, heatIndex: 999 }),
    ]);
    expect(m.heatIndex).not.toBe(999);
    expect(m.absoluteHumidity).toBeGreaterThan(0);
    expect(m.airDensityEnhanced).toBeGreaterThan(0);
  });
  it('recomputes the gust factor via calculateGustFactor from the merged gust and sustained', () => {
    const m = mergeWeatherData([
      base({ windSpeed: 5, windGustSpeed: 10 }),
      base({ windSpeed: 5, windGustSpeed: 10 }),
    ]);
    expect(m.windGustFactor).toBeCloseTo(2, 5); // merged gust 10 over merged sustained 5
  });
  it('omits the gust factor when the merged gust falls below the merged sustained', () => {
    // gust is hazard-max (8) but sustained is the mean (10), so calculateGustFactor omits it.
    const m = mergeWeatherData([
      base({ windSpeed: 5, windGustSpeed: 8 }),
      base({ windSpeed: 15, windGustSpeed: 8 }),
    ]);
    expect(m.windGustFactor).toBeUndefined();
  });
  it('excludes the apparent-wind fields from its output', () => {
    const m = mergeWeatherData([base({}), base({})]);
    expect(m.apparentWindSpeed).toBeUndefined();
    expect(m.apparentWindAngle).toBeUndefined();
    expect(m.apparentWindChill).toBeUndefined();
  });
  it('takes the timestamp from the primary', () => {
    const m = mergeWeatherData([base({ timestamp: 'A' }), base({ timestamp: 'B' })]);
    expect(m.timestamp).toBe('A');
  });
  it('declares a merge kind for EVERY WeatherData field', () => {
    // A fully-populated sample: every required and optional field set. The keys of
    // this sample must exactly match the keys of FIELD_MERGE_KINDS, so a field added
    // to WeatherData later without a declared merge kind fails this test.
    const full: Required<WeatherData> = {
      temperature: 290,
      pressure: 101000,
      humidity: 0.5,
      windSpeed: 5,
      windDirection: 0,
      dewPoint: 283,
      windChill: 290,
      heatIndex: 290,
      realFeel: 300,
      realFeelShade: 298,
      wetBulbTemperature: 285,
      wetBulbGlobeTemperature: 305,
      apparentTemperature: 295,
      windGustSpeed: 10,
      windGustFactor: 2,
      uvIndex: 5,
      visibility: 8000,
      cloudCover: 0.4,
      cloudCeiling: 1000,
      precipitationLastHour: 0,
      temperatureDeparture24h: 2,
      apparentWindSpeed: 7,
      apparentWindAngle: 0.5,
      apparentWindChill: 288,
      description: 'Clear',
      weatherIcon: 1,
      severeCondition: { state: 'normal', label: '' },
      timestamp: 'T',
      beaufortScale: 3,
      airDensityEnhanced: 1.22,
      absoluteHumidity: 0.01,
      heatStressIndex: 1,
      pressureTendency: 0,
      precipitationType: 'Rain',
      visibilityObstruction: 'Fog',
    };
    expect(Object.keys(FIELD_MERGE_KINDS).sort()).toEqual(Object.keys(full).sort());
  });
});

describe('mergeWeatherData: conservative hazard drivers', () => {
  it('keeps the gale band a second provider would have averaged away', () => {
    // AccuWeather at 18.0 m/s is Bf8, Open-Meteo at 15.0 m/s is Bf7. The mean
    // of 16.5 m/s is Bf7, so averaging the FORCE cancelled a gale warning that
    // one provider raised on its own.
    const accu = base({ windSpeed: 18, beaufortScale: 8 });
    const openMeteo = base({ windSpeed: 15, beaufortScale: 7 });
    const merged = mergeWeatherData([accu, openMeteo]);

    expect(merged.beaufortScale).toBe(8);
    // The published measurement stays the blend: only the hazard category is
    // taken conservatively.
    expect(merged.windSpeed).toBeCloseTo(16.5, 5);
  });

  it('keeps the coldest survivor wind chill', () => {
    const cold = base({ temperature: 248.15, windSpeed: 20, windChill: 228.54 });
    const mild = base({ temperature: 268.15, windSpeed: 2, windChill: 268.0 });
    expect(mergeWeatherData([mild, cold]).windChill).toBeCloseTo(228.54, 5);
  });

  it('keeps the heat band the milder survivor would have averaged away', () => {
    const hot = base({ heatStressIndex: 4 });
    const mild = base({ heatStressIndex: 2 });
    expect(mergeWeatherData([mild, hot]).heatStressIndex).toBe(4);
  });

  it('keeps the strongest reported gust rather than the mean of two', () => {
    const gusty = base({ windSpeed: 12, windGustSpeed: 28 });
    const calm = base({ windSpeed: 12, windGustSpeed: 14 });
    expect(mergeWeatherData([calm, gusty]).windGustSpeed).toBe(28);
  });

  it('keeps the worst reported visibility rather than the mean of two', () => {
    const fog = base({ visibility: 400 });
    const clear = base({ visibility: 20000 });
    expect(mergeWeatherData([clear, fog]).visibility).toBe(400);
  });

  it('keeps the heaviest reported past-hour precipitation', () => {
    const heavy = base({ precipitationLastHour: 12.5 });
    const light = base({ precipitationLastHour: 0.2 });
    expect(mergeWeatherData([light, heavy]).precipitationLastHour).toBe(12.5);
  });

  it('keeps the highest-severity condition even when the primary reports a milder one', () => {
    const severe = base({
      severeCondition: { state: 'alarm', label: 'Severe thunderstorm' },
    });
    const mild = base({ severeCondition: { state: 'warn', label: 'Rain' } });
    expect(mergeWeatherData([mild, severe]).severeCondition).toEqual({
      state: 'alarm',
      label: 'Severe thunderstorm',
    });
  });

  it('declares every hazard driver conservative in FIELD_MERGE_KINDS', () => {
    // Not a restatement of the behaviour above: the merge dispatches on these
    // entries, so changing one here changes what actually runs.
    expect(FIELD_MERGE_KINDS.beaufortScale).toBe('hazard-max');
    expect(FIELD_MERGE_KINDS.heatStressIndex).toBe('hazard-max');
    expect(FIELD_MERGE_KINDS.windChill).toBe('hazard-min');
    expect(FIELD_MERGE_KINDS.windGustSpeed).toBe('hazard-max');
    expect(FIELD_MERGE_KINDS.visibility).toBe('hazard-min');
    expect(FIELD_MERGE_KINDS.precipitationLastHour).toBe('hazard-max');
    expect(FIELD_MERGE_KINDS.severeCondition).toBe('hazard-max');
  });
});
