/**
 * Unit tests for the NWS alerts to WeatherWarning mapper: field preference,
 * ascending sort, the source fallback, and dropping typeless features.
 */

import { describe, expect, it } from 'vitest';
import { mapNwsAlertsToWarnings } from '../../mappers/WarningsMapper.js';

describe('mapNwsAlertsToWarnings', () => {
  it('maps alerts, prefers onset/ends/headline, and sorts ascending by start', () => {
    const warnings = mapNwsAlertsToWarnings({
      features: [
        {
          properties: {
            event: 'Gale Warning',
            onset: '2026-06-17T10:00:00Z',
            ends: '2026-06-17T22:00:00Z',
            headline: 'Gale Warning issued',
            description: 'long description',
            senderName: 'NWS Miami FL',
          },
        },
        {
          properties: {
            event: 'Small Craft Advisory',
            effective: '2026-06-17T06:00:00Z',
            expires: '2026-06-17T18:00:00Z',
            description: 'SCA in effect',
          },
        },
      ],
    });

    expect(warnings).toHaveLength(2);
    // Ascending by start time: the 06:00 SCA precedes the 10:00 gale.
    expect(warnings[0]?.type).toBe('Small Craft Advisory');
    expect(warnings[0]?.startTime).toBe('2026-06-17T06:00:00Z');
    expect(warnings[0]?.endTime).toBe('2026-06-17T18:00:00Z');
    expect(warnings[0]?.details).toBe('SCA in effect'); // falls back to description
    expect(warnings[0]?.source).toBe('NWS'); // no senderName -> default
    expect(warnings[1]?.type).toBe('Gale Warning');
    expect(warnings[1]?.details).toBe('Gale Warning issued'); // headline preferred
    expect(warnings[1]?.source).toBe('NWS Miami FL');
  });

  it('returns empty for no features and drops features with no event type', () => {
    expect(mapNwsAlertsToWarnings({})).toEqual([]);
    expect(mapNwsAlertsToWarnings({ features: [{ properties: { headline: 'x' } }] })).toEqual([]);
  });
});
