import { describe, expect, it } from 'vitest';
import { buildSkOutsideSI, buildWindFromMs } from '../../mappers/skV2Envelope.js';

describe('buildWindFromMs', () => {
  it('passes m/s speeds through and converts the direction to radians in [0, 2pi)', () => {
    const wind = buildWindFromMs(5, 90, 8);
    expect(wind?.speedTrue).toBeCloseTo(5, 5);
    expect(wind?.gust).toBeCloseTo(8, 5);
    expect(wind?.directionTrue).toBeCloseTo(Math.PI / 2, 5);
  });
  it('omits absent fields and returns undefined when nothing is present', () => {
    expect(buildWindFromMs(5, null, null)).toEqual({ speedTrue: 5 });
    expect(buildWindFromMs(null, null, null)).toBeUndefined();
  });
  it('normalizes a 360 degree direction to 0, not 2pi', () => {
    expect(buildWindFromMs(null, 360, null)?.directionTrue).toBe(0);
  });
});

describe('buildSkOutsideSI', () => {
  it('spreads present SI fields and derives absoluteHumidity from temperature and humidity', () => {
    const out = buildSkOutsideSI({
      temperatureK: 293.15,
      rhRatio: 0.5,
      pressurePa: 101300,
      cloudCover: 0.25,
    });
    expect(out.temperature).toBeCloseTo(293.15, 5);
    expect(out.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out.pressure).toBeCloseTo(101300, 0);
    expect(out.cloudCover).toBeCloseTo(0.25, 5);
    expect(typeof out.absoluteHumidity).toBe('number');
  });
  it('omits absent fields and omits absoluteHumidity when temperature is missing', () => {
    const out = buildSkOutsideSI({ rhRatio: 0.5 });
    expect(out.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out.absoluteHumidity).toBeUndefined();
    expect(out.temperature).toBeUndefined();
    expect(Object.keys(out)).toEqual(['relativeHumidity']);
  });
  it('maps all of precipitationVolumeM, feelsLikeK, dewPointK, uvIndex, and visibilityM to the right SKOutside fields', () => {
    const out = buildSkOutsideSI({
      temperatureK: 293.15,
      rhRatio: 0.6,
      precipitationVolumeM: 0.003,
      feelsLikeK: 295.0,
      dewPointK: 285.0,
      uvIndex: 5.4,
      visibilityM: 12000,
    });
    expect(out.precipitationVolume).toBeCloseTo(0.003, 6);
    expect(out.feelsLikeTemperature).toBeCloseTo(295.0, 5);
    expect(out.dewPointTemperature).toBeCloseTo(285.0, 5);
    expect(out.uvIndex).toBeCloseTo(5.4, 5);
    expect(out.horizontalVisibility).toBeCloseTo(12000, 0);
    // absoluteHumidity is derived because both temperatureK and rhRatio are present.
    expect(typeof out.absoluteHumidity).toBe('number');
  });
});
