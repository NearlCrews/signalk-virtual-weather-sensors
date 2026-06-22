import { describe, expect, it } from 'vitest';
import { metNoSevereCondition } from '../../providers/met-no-severity.js';

describe('metNoSevereCondition', () => {
  it('classifies snow, sleet, and thunder as warn, ignoring the day/night suffix', () => {
    expect(metNoSevereCondition('snow')?.state).toBe('warn');
    expect(metNoSevereCondition('lightsnowshowers_day')?.label).toBe('Snow');
    expect(metNoSevereCondition('sleet_night')?.label).toBe('Sleet');
    expect(metNoSevereCondition('rainandthunder')?.label).toBe('Thunderstorms');
    expect(metNoSevereCondition('heavysleetandthunder_day')?.label).toBe('Thunderstorms');
    expect(metNoSevereCondition('snowandthunder')?.label).toBe('Thunderstorms'); // thunder wins
  });
  it('returns undefined for benign or liquid-precipitation codes', () => {
    expect(metNoSevereCondition('clearsky_day')).toBeUndefined();
    expect(metNoSevereCondition('rain')).toBeUndefined();
    expect(metNoSevereCondition('heavyrainshowers_night')).toBeUndefined();
    expect(metNoSevereCondition('fog')).toBeUndefined();
    expect(metNoSevereCondition(undefined)).toBeUndefined();
  });
});
