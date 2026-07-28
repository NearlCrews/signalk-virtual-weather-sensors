import { describe, expect, it } from 'vitest';
import { isPanelStatusResponse } from '../../configpanel/hooks/useStatus.js';

const validStatus = {
  running: true,
  banner: 'Running',
  updates: 4,
  quotaUsedLast24h: 6,
  lastUpdateMinutesAgo: 1,
  activeNotifications: 0,
  weatherProviderRegistered: true,
};

describe('isPanelStatusResponse', () => {
  it('accepts the status endpoint contract', () => {
    expect(isPanelStatusResponse(validStatus)).toBe(true);
    expect(isPanelStatusResponse({ ...validStatus, lastUpdateMinutesAgo: null })).toBe(true);
  });

  it('rejects malformed objects, arrays, and non-finite counters', () => {
    expect(isPanelStatusResponse({ ...validStatus, running: 'yes' })).toBe(false);
    expect(isPanelStatusResponse({ ...validStatus, updates: Number.NaN })).toBe(false);
    expect(isPanelStatusResponse({ ...validStatus, activeNotifications: -1 })).toBe(false);
    expect(isPanelStatusResponse({ ...validStatus, lastUpdateMinutesAgo: 1.5 })).toBe(false);
    expect(isPanelStatusResponse([validStatus])).toBe(false);
  });
});
