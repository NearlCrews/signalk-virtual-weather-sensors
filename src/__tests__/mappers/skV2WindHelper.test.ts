import { describe, expect, it } from 'vitest';
import { buildWindFromMs } from '../../mappers/skV2WindHelper.js';

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
