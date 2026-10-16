/**
 * Unit tests for WarningsService: region dispatch (NWS for US points, MetAlerts
 * for Norwegian-waters points, an empty list elsewhere, URL construction, and
 * explicit behavior on a fetch failure.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WarningsService } from '../../services/WarningsService.js';
import { createMockFetchResponse } from '../setup.js';

const MIAMI = { latitude: 25.7743, longitude: -80.1937 };
const OPEN_OCEAN = { latitude: -33.9, longitude: 18.4 }; // off Cape Town, outside both US and Nordic boxes

describe('WarningsService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches and maps NWS warnings for a US point', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse({
        features: [
          {
            properties: {
              event: 'Gale Warning',
              onset: '2026-06-17T10:00:00Z',
              ends: '2026-06-17T22:00:00Z',
              headline: 'Gale Warning',
              senderName: 'NWS Miami FL',
            },
          },
        ],
      })
    );
    const service = new WarningsService();

    const warnings = await service.getWarnings(MIAMI);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.type).toBe('Gale Warning');
    const url = String((global.fetch as Mock).mock.calls[0][0]);
    expect(url).toContain('api.weather.gov/alerts/active?point=25.7743,-80.1937');
  });

  it('returns an empty list without a network call outside covered regions', async () => {
    const logger = vi.fn();
    const service = new WarningsService(logger);
    await expect(service.getWarnings(OPEN_OCEAN)).resolves.toEqual([]);
    expect(global.fetch as Mock).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      'debug',
      'No warnings feed covers this position, returning none',
      { point: '-33.9000,18.4000' }
    );
  });

  it('reports an NWS fetch failure instead of returning a false clear', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse('err', { ok: false, status: 500 })
    );
    const service = new WarningsService();
    await expect(service.getWarnings(MIAMI)).rejects.toThrow('NWS warnings unavailable');
  });

  it('treats an NWS 400 out-of-bounds answer as no warnings', async () => {
    // NWS answers 400 for a point inside the generous US box but outside its
    // coverage (British Columbia, Bermuda, Mexico). That is a documented
    // limitation, not an outage, so it must not surface as a consumer error.
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse(
        { status: 400, detail: 'Parameter "point" is invalid: out of bounds' },
        { ok: false, status: 400, statusText: 'Bad Request' }
      )
    );
    const service = new WarningsService();
    await expect(service.getWarnings({ latitude: 48.4, longitude: -123.4 })).resolves.toEqual([]);
  });

  it('still reports other NWS client errors, including a 400 for another reason', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse('err', { ok: false, status: 404, statusText: 'Not Found' })
    );
    const service = new WarningsService();
    await expect(service.getWarnings(MIAMI)).rejects.toThrow('NWS warnings unavailable');

    // A 400 that is not the out-of-bounds answer (a malformed request) must not
    // turn into a false all-clear for a covered position.
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse(
        { status: 400, detail: 'Parameter "point" is invalid: bad format' },
        { ok: false, status: 400, statusText: 'Bad Request' }
      )
    );
    await expect(service.getWarnings(MIAMI)).rejects.toThrow('NWS warnings unavailable');
  });

  it('makes no NWS request for Pacific positions outside the US territories', async () => {
    const service = new WarningsService();
    await expect(service.getWarnings({ latitude: 38.3, longitude: 141.0 })).resolves.toEqual([]);
    expect(global.fetch as Mock).not.toHaveBeenCalled();
  });

  it.each([
    ['Guam', { latitude: 13.4, longitude: 144.7 }],
    ['the western Aleutians', { latitude: 52.9, longitude: 173.2 }],
    ['American Samoa', { latitude: -14.3, longitude: -170.7 }],
  ])('routes %s to NWS', async (_name, point) => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse({ features: [] }));
    const service = new WarningsService();
    await expect(service.getWarnings(point)).resolves.toEqual([]);
    expect(String((global.fetch as Mock).mock.calls[0][0])).toContain('api.weather.gov');
  });

  it('fetches MetAlerts for a Norwegian-waters position and maps the result', async () => {
    const metAlerts = {
      features: [
        {
          when: { interval: ['2026-06-20T22:00:00+00:00', '2026-06-21T18:00:00+00:00'] },
          properties: { event: 'gale', eventAwarenessName: 'Gale', description: 'Gale force 8.' },
        },
      ],
    };
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(metAlerts));
    const svc = new WarningsService();
    const warnings = await svc.getWarnings({ latitude: 62.5, longitude: 6.0 }); // Norwegian coast
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.type).toBe('Gale');
    expect(warnings[0]?.source).toBe('MET Norway');
    const call = (global.fetch as Mock).mock.calls[0];
    const url = String(call[0]);
    expect(url).toContain('api.met.no/weatherapi/metalerts/2.0/current.json');
    expect(url).toContain('lat=62.5000');
    expect(url).toContain('lon=6.0000');
    const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('github.com');
  });

  it('reports when the MetAlerts fetch fails', async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error('network'));
    const svc = new WarningsService();
    await expect(svc.getWarnings({ latitude: 62.5, longitude: 6.0 })).rejects.toThrow(
      'MET Norway warnings unavailable'
    );
  });

  it('dispatches to MetAlerts at the inclusive SW corner of NORDIC_BOX', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse({ features: [] }));
    const service = new WarningsService();
    const warnings = await service.getWarnings({ latitude: 54, longitude: -12 });
    expect(warnings).toEqual([]);
    const url = String((global.fetch as Mock).mock.calls[0][0]);
    expect(url).toContain('api.met.no/weatherapi/metalerts/2.0/current.json');
  });
});
