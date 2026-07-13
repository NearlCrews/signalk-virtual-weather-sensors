/**
 * Unit tests for WarningsService: region dispatch (NWS for US points, MetAlerts
 * for Norwegian-waters points, explicit unsupported coverage elsewhere, URL
 * construction, and explicit behavior on a fetch failure.
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

  it('reports unsupported coverage without a network call outside covered regions', async () => {
    const service = new WarningsService();
    await expect(service.getWarnings(OPEN_OCEAN)).rejects.toThrow('Not supported!');
    expect(global.fetch as Mock).not.toHaveBeenCalled();
  });

  it('reports an NWS fetch failure instead of returning a false clear', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse('err', { ok: false, status: 500 })
    );
    const service = new WarningsService();
    await expect(service.getWarnings(MIAMI)).rejects.toThrow('NWS warnings unavailable');
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
