/**
 * Unit tests for the NWS alerts to WeatherWarning mapper: field preference,
 * ascending sort, the source fallback, and dropping typeless features.
 */

import { describe, expect, it } from 'vitest';
import {
  type MetAlertsResponse,
  mapMetAlertsToWarnings,
  mapNwsAlertsToWarnings,
} from '../../mappers/WarningsMapper.js';

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

  it('sorts chronologically across UTC offsets, not lexically', () => {
    // The later instant carries an earlier-sorting local offset string, so a
    // lexical string compare would order these backwards. 12:00-05:00 (17:00Z)
    // is later than 09:00+01:00 (08:00Z).
    const warnings = mapNwsAlertsToWarnings({
      features: [
        {
          properties: {
            event: 'Later',
            onset: '2026-06-17T12:00:00-05:00',
            ends: '2026-06-17T19:00:00-05:00',
          },
        },
        {
          properties: {
            event: 'Earlier',
            onset: '2026-06-17T09:00:00+01:00',
            ends: '2026-06-17T12:00:00+01:00',
          },
        },
      ],
    });
    expect(warnings.map((w) => w.type)).toEqual(['Earlier', 'Later']);
  });
});

describe('mapMetAlertsToWarnings', () => {
  const sample: MetAlertsResponse = {
    features: [
      {
        when: { interval: ['2026-06-20T22:00:00+00:00', '2026-06-21T18:00:00+00:00'] },
        properties: {
          event: 'gale',
          eventAwarenessName: 'Gale',
          severity: 'Moderate',
          title: 'Gale, yellow level, Ona - Froeya',
          description: 'Southwest occasionally gale force 8.',
          instruction: 'Do not go out in a small boat.',
          area: 'Ona - Froeya',
        },
      },
      {
        when: { interval: ['2026-06-20T12:00:00+00:00', '2026-06-20T20:00:00+00:00'] },
        properties: {
          event: 'polarLow',
          eventAwarenessName: 'Polar low',
          description: 'Polar low approaching.',
        },
      },
    ],
  };

  it('maps MetAlerts features to WeatherWarning, ascending by start time', () => {
    const out = mapMetAlertsToWarnings(sample);
    expect(out).toHaveLength(2);
    // The 12:00 polar low sorts before the 22:00 gale.
    expect(out[0]?.type).toBe('Polar low');
    expect(out[0]?.startTime).toBe('2026-06-20T12:00:00+00:00');
    expect(out[1]?.type).toBe('Gale');
    expect(out[1]?.startTime).toBe('2026-06-20T22:00:00+00:00');
    expect(out[1]?.endTime).toBe('2026-06-21T18:00:00+00:00');
    expect(out[1]?.source).toBe('MET Norway');
    // Details prefer the description and append the instruction when present.
    expect(out[1]?.details).toBe(
      'Southwest occasionally gale force 8. Do not go out in a small boat.'
    );
  });

  it('falls back to the title for details and to the event for the type', () => {
    const out = mapMetAlertsToWarnings({
      features: [
        {
          when: { interval: ['2026-06-20T00:00:00+00:00', '2026-06-20T06:00:00+00:00'] },
          properties: { event: 'wind', title: 'Wind warning' },
        },
      ],
    });
    expect(out[0]?.type).toBe('wind'); // no eventAwarenessName, falls back to event
    expect(out[0]?.details).toBe('Wind warning'); // no description, falls back to title
  });

  it('drops features with no event type or no start time, and returns [] for an empty feed', () => {
    expect(mapMetAlertsToWarnings({ features: [] })).toEqual([]);
    expect(mapMetAlertsToWarnings({})).toEqual([]);
    const out = mapMetAlertsToWarnings({
      features: [
        {
          when: { interval: ['2026-06-20T00:00:00+00:00', ''] },
          properties: { description: 'no type' },
        },
        { when: { interval: [] }, properties: { event: 'gale' } }, // no start time
      ],
    });
    expect(out).toEqual([]);
  });
});

describe('WarningsMapper: bounded external text', () => {
  const longText = 'a'.repeat(2000);
  /** Control characters an external feed can smuggle into a republished field. */
  const CONTROL_CHARS = '\x00\x07\x1b\x7f';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the mapper strips exactly these
  const CONTROL_RE = /[\x00-\x1f\x7f]/;

  it('caps an NWS description and strips control characters', () => {
    const [warning] = mapNwsAlertsToWarnings({
      features: [
        {
          properties: {
            event: `Gale Warning${CONTROL_CHARS}${'x'.repeat(200)}`,
            onset: '2026-06-17T05:00:00Z',
            ends: '2026-06-17T17:00:00Z',
            description: `${longText}tail`,
            senderName: `NWS ${'y'.repeat(200)}`,
          },
        },
      ],
    });
    if (!warning) throw new Error('expected one warning');
    // An NWS description routinely runs to several kilobytes, and the only
    // other ceiling in the path is the 1 MiB whole-body cap.
    expect(warning.details.length).toBe(512);
    expect(warning.type.length).toBe(64);
    expect(warning.source.length).toBe(64);
    for (const field of [warning.details, warning.type, warning.source]) {
      expect(CONTROL_RE.test(field)).toBe(false);
    }
  });

  it('caps the joined MetAlerts description and instruction', () => {
    const [warning] = mapMetAlertsToWarnings({
      features: [
        {
          when: { interval: ['2026-06-17T05:00:00Z', '2026-06-17T17:00:00Z'] },
          properties: {
            eventAwarenessName: 'Gale',
            description: longText,
            instruction: longText,
          },
        },
      ],
    });
    if (!warning) throw new Error('expected one warning');
    expect(warning.details.length).toBe(512);
  });

  it('leaves short text untouched', () => {
    const [warning] = mapMetAlertsToWarnings({
      features: [
        {
          when: { interval: ['2026-06-17T05:00:00Z', '2026-06-17T17:00:00Z'] },
          properties: {
            eventAwarenessName: 'Gale',
            description: 'Strong gale expected.',
            instruction: 'Do not go out in a small boat.',
          },
        },
      ],
    });
    expect(warning?.details).toBe('Strong gale expected. Do not go out in a small boat.');
  });
});
