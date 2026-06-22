# Met.no MetAlerts Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Met.no MetAlerts severe-weather warnings for Norwegian waters through the v2 Weather API `getWarnings`, so a vessel in Norwegian and adjacent waters gets real marine alerts (gale, polar low, storm surge, icing, and wind) instead of an empty list.

**Architecture:** This extends the region-aware `WarningsService`, which already dispatches `getWarnings(position)` by region (NWS CAP for US waters today, an empty list elsewhere). Phase 3 of the Met.no work adds Norwegian waters as the second region: a `NORDIC_BOX` bounding-box check routes a Norwegian-waters position to a keyless MetAlerts fetch, mapped to the SK v2 `WeatherWarning` shape by a new pure `mapMetAlertsToWarnings`, paralleling the existing `mapNwsAlertsToWarnings`. Warnings are region-sourced by position, not by the active weather provider, so this benefits any registered v2 provider (Open-Meteo, AccuWeather, or Met.no) whose vessel is in range. No change to `index.ts`, `WeatherProviderAdapter`, the panel, or the schema: the adapter already routes `getWarnings` through `WarningsService`.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- The SK v2 `WeatherWarning` shape is `{ startTime, endTime, details, source, type }` (all strings), exactly what `mapNwsAlertsToWarnings` already produces. Warnings are returned ascending by start time. The existing `str()` and `byStartAscending()` helpers in `WarningsMapper.ts` are reused, not re-derived.
- MetAlerts facts (verified June 2026): `GET https://api.met.no/weatherapi/metalerts/2.0/current.json?lat=<lat>&lon=<lon>&lang=en` returns a GeoJSON `FeatureCollection`. Each feature carries `when.interval` (a two-element array of ISO 8601 strings: onset at index 0, expiry at index 1) and a `properties` block with `event` (a camelCase type like `gale`, `wind`, `polarLow`, `stormSurge`, or `icing`), `eventAwarenessName` (a localized label like `Gale`), `severity`, `title`, `description`, `instruction`, and `area`. A position with no active alerts returns HTTP 200 with `features: []`, so it is treated as a clean no-warnings result, identical to the NWS empty path. Coverage is Norway and Norwegian waters only (mainland, the Norwegian Sea, the North Sea Norwegian sector, the Barents Sea, Svalbard, and Jan Mayen); a position outside that range returns an empty feature list. `lang=en` makes `description`, `title`, and `instruction` English (the `event` type is always English camelCase regardless).
- Met.no requires an identifying contact User-Agent (the same string the plugin already uses for the Locationforecast and NWS calls), or it returns 403. Coordinates use at most 4 decimals (`toFixed(4)`). The fetch is best-effort: an outage, an uncovered point, or a malformed response yields an empty list and a log line, never a thrown error to the consumer (the NWS path's contract). Met.no asks for at most one MetAlerts poll per 10 minutes; the v2 adapter's `getWarnings` is consumer-driven and the adapter caches, so no extra throttling is added here, and conditional `If-Modified-Since` polling stays a deferred politeness item (shared with the phase-2 note).
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 495 tests; only add tests, never reduce the count.
- Commit type `feat:` for both tasks (each adds user-visible warning coverage).

Note: this is a two-task plan. Task 1 (the type and the pure mapper) is self-contained and has no dependency on Task 2. Task 2 (the service dispatch) imports the Task 1 mapper, so Task 1 lands first.

---

### Task 1: Add the MetAlerts response type and the warnings mapper

**Files:**
- Modify: `src/mappers/WarningsMapper.ts` (add the type and the mapper next to the NWS ones)
- Test: `src/__tests__/mappers/WarningsMapper.test.ts` (extend)

**Interfaces:**
- Produces: `MetAlertsResponse` (the MetAlerts GeoJSON shape, only mapped fields) and `mapMetAlertsToWarnings(response: MetAlertsResponse): WeatherWarning[]` in `WarningsMapper.ts`, paralleling `NwsAlertsResponse` and `mapNwsAlertsToWarnings`. It reuses the module-local `str()` and `byStartAscending()` helpers.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/mappers/WarningsMapper.test.ts` (merge the import of `mapMetAlertsToWarnings` and `type MetAlertsResponse` into the existing import from `WarningsMapper.js`, do not add a second import declaration):

```ts
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
        properties: { event: 'polarLow', eventAwarenessName: 'Polar low', description: 'Polar low approaching.' },
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
    expect(out[1]?.details).toBe('Southwest occasionally gale force 8. Do not go out in a small boat.');
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
        { when: { interval: ['2026-06-20T00:00:00+00:00', ''] }, properties: { description: 'no type' } },
        { when: { interval: [] }, properties: { event: 'gale' } }, // no start time
      ],
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/WarningsMapper.test.ts`
Expected: FAIL, `mapMetAlertsToWarnings` is not exported.

- [ ] **Step 3: Add the type and the mapper to `WarningsMapper.ts`**

Add the type next to `NwsAlertsResponse`:

```ts
/** Minimal shape of the Met.no MetAlerts `/current.json` GeoJSON response (only mapped fields). */
export interface MetAlertsResponse {
  readonly features?: ReadonlyArray<{
    readonly when?: { readonly interval?: ReadonlyArray<string> };
    readonly properties?: {
      readonly event?: string | null;
      readonly eventAwarenessName?: string | null;
      readonly severity?: string | null;
      readonly title?: string | null;
      readonly description?: string | null;
      readonly instruction?: string | null;
      readonly area?: string | null;
    };
  }>;
}
```

Add the mapper, reusing `str` and `byStartAscending`:

```ts
/**
 * Map a Met.no MetAlerts response to WeatherWarning[]. The start and end times
 * come from `when.interval` (onset at index 0, expiry at index 1). The type
 * prefers the localized `eventAwarenessName` (for example `Gale`), falling back
 * to the camelCase `event` (for example `gale`). Details prefer the narrative
 * `description`, falling back to the `title`, and append the `instruction` when
 * present, since the marine instruction (for example "Do not go out in a small
 * boat") is the actionable part. Features with no type or no start time are
 * dropped, the same contract as the NWS mapper. The source is MET Norway.
 */
export function mapMetAlertsToWarnings(response: MetAlertsResponse): WeatherWarning[] {
  const features = response.features ?? [];
  const warnings = features
    .map((feature) => {
      const p = feature.properties ?? {};
      const interval = feature.when?.interval ?? [];
      const base = str(p.description) || str(p.title);
      const instruction = str(p.instruction);
      const details = instruction.length > 0 ? `${base} ${instruction}`.trim() : base;
      return {
        startTime: str(interval[0]),
        endTime: str(interval[1]),
        details,
        source: 'MET Norway',
        type: str(p.eventAwarenessName) || str(p.event),
      };
    })
    .filter((warning) => warning.type.length > 0 && warning.startTime.length > 0);
  return warnings.sort(byStartAscending);
}
```

Note: the v2 `WeatherWarning` shape carries no severity or area field, so `severity` and `area` are not mapped (they are typed for documentation and a possible later enrichment). Do NOT add a `geographicDomain=marine` filter here: this mapper is pure over whatever features the service fetched, and returning every alert that covers the vessel position (land or marine) parallels the NWS path, which does not filter by domain either.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/mappers/WarningsMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/mappers/WarningsMapper.ts src/__tests__/mappers/WarningsMapper.test.ts
git commit -m "feat: map Met.no MetAlerts to the v2 WeatherWarning shape"
```

---

### Task 2: Dispatch Norwegian-waters warnings to MetAlerts

**Files:**
- Modify: `src/services/WarningsService.ts`
- Test: `src/__tests__/services/WarningsService.test.ts` (extend)

**Interfaces:**
- Consumes: `mapMetAlertsToWarnings` and `MetAlertsResponse` from `WarningsMapper.js` (Task 1).
- Produces: a Norwegian-waters branch in `WarningsService.getWarnings`. A `NORDIC_BOX` plus `inNordicCoverage(location)` route a position to a new private `fetchMetAlerts(location)` that fetches the MetAlerts `/current.json` endpoint and maps it, best-effort.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/services/WarningsService.test.ts`, following the existing NWS test idiom (it mocks `fetch` and asserts the URL and the User-Agent header; reuse that setup). Cover three things: a Norwegian-waters position fetches the MetAlerts URL with the contact User-Agent and maps the result, a US position still fetches NWS, and a MetAlerts fetch failure returns an empty list.

```ts
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

it('returns an empty list when the MetAlerts fetch fails', async () => {
  (global.fetch as Mock).mockRejectedValueOnce(new Error('network'));
  const svc = new WarningsService();
  const warnings = await svc.getWarnings({ latitude: 62.5, longitude: 6.0 });
  expect(warnings).toEqual([]);
});
```

The file already mocks `fetch` via `vi.stubGlobal('fetch', vi.fn())` in a `beforeEach`, and already imports `type Mock` from vitest and `createMockFetchResponse` from `../setup.js`, so add NO new imports; reuse that setup and the `new WarningsService()` (no-arg) idiom the existing tests use.

REQUIRED existing-test update (or the gate goes red): the file currently has a constant `NORWAY = { latitude: 60.0, longitude: 10.0 }` (line 12) and a test `'returns empty without a network call outside US coverage'` (lines 45-50) that calls `getWarnings(NORWAY)` and asserts `fetch` was NOT called. After this task, `NORWAY` (60, 10) is inside `NORDIC_BOX`, so it now dispatches to MetAlerts and DOES fetch, which breaks that test. Update it: replace the `NORWAY` constant with an out-of-all-coverage point, for example `const OPEN_OCEAN = { latitude: -33.9, longitude: 18.4 };` (off Cape Town, outside both the US and the Nordic boxes), rename the test to `'returns empty without a network call outside all covered regions'`, point it at `OPEN_OCEAN`, and keep the two assertions (`toEqual([])` and `fetch` not called). The existing US (MIAMI) test and the best-effort failure test are unchanged. The new MetAlerts tests use their own Norwegian-waters coordinates (62.5, 6.0).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/services/WarningsService.test.ts`
Expected: FAIL, the Norwegian-waters position currently returns `[]` (no MetAlerts dispatch yet), so the URL assertion fails.

- [ ] **Step 3: Add the MetAlerts dispatch to `WarningsService.ts`**

Generalize the User-Agent constant (both NWS and Met.no use the identical contact string), add the imports, the bounding box, the coverage check, and the fetch method, and extend the dispatch:

1. Rename the `NWS_USER_AGENT` constant to `CONTACT_USER_AGENT` (same value), update its doc comment to note both NWS and Met.no require it, and use it in both fetch methods.
2. Add the Task 1 imports to the existing `WarningsMapper.js` import: `mapMetAlertsToWarnings, type MetAlertsResponse` (merge into the line that already imports `mapNwsAlertsToWarnings, type NwsAlertsResponse`).
3. Add the bounding box and the coverage check, modeled on `US_BOX` / `inUsCoverage`:

```ts
/**
 * Loose bounding box for Met.no MetAlerts coverage (Norway and Norwegian waters:
 * the mainland, the Norwegian Sea, the North Sea Norwegian sector, the Barents
 * Sea, Svalbard, and Jan Mayen). Deliberately generous, like US_BOX: MetAlerts
 * returns no features for a position it does not cover, and the fetch is
 * best-effort, so over-inclusion only costs an occasional empty lookup.
 */
const NORDIC_BOX = { latMin: 54, latMax: 82, lonMin: -12, lonMax: 37 } as const;
```

```ts
private inNordicCoverage(location: GeoLocation): boolean {
  const { latitude, longitude } = location;
  return (
    latitude >= NORDIC_BOX.latMin &&
    latitude <= NORDIC_BOX.latMax &&
    longitude >= NORDIC_BOX.lonMin &&
    longitude <= NORDIC_BOX.lonMax
  );
}
```

4. Extend `getWarnings` to dispatch the second region (US is checked first, since the two boxes do not overlap in longitude):

```ts
public async getWarnings(location: GeoLocation): Promise<WeatherWarning[]> {
  if (this.inUsCoverage(location)) {
    return this.fetchNws(location);
  }
  if (this.inNordicCoverage(location)) {
    return this.fetchMetAlerts(location);
  }
  return [];
}
```

5. Add the fetch method, modeled on `fetchNws` (best-effort, empty on any failure):

```ts
/** Fetch and map Met.no MetAlerts active alerts, best-effort (empty on any failure). */
private async fetchMetAlerts(location: GeoLocation): Promise<WeatherWarning[]> {
  const lat = location.latitude.toFixed(4);
  const lon = location.longitude.toFixed(4);
  const url = `https://api.met.no/weatherapi/metalerts/2.0/current.json?lat=${lat}&lon=${lon}&lang=en`;
  try {
    const response = await fetchJson<MetAlertsResponse>(url, {
      timeoutMs: this.requestTimeoutMs,
      headers: { 'User-Agent': CONTACT_USER_AGENT },
    });
    return mapMetAlertsToWarnings(response);
  } catch (error) {
    this.logger('warn', 'MetAlerts warnings fetch failed; returning no warnings', {
      point: `${lat},${lon}`,
      error: toErrorMessage(error),
    });
    return [];
  }
}
```

6. Update the class doc comment: the line "Met.no MetAlerts for Nordic waters is a planned second source; the region dispatch below is the seam it slots into" becomes a statement that MetAlerts now serves Norwegian waters as the second region, keyless with the same contact User-Agent.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/services/WarningsService.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/services/WarningsService.ts src/__tests__/services/WarningsService.test.ts
git commit -m "feat: serve Met.no MetAlerts warnings for Norwegian waters"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 495 plus the new mapper and service tests).
- [ ] A Norwegian-waters position returns mapped MetAlerts warnings; a US position still returns NWS warnings; a position in neither box returns an empty list.
- [ ] The MetAlerts fetch is best-effort: a network failure, an empty `features` array, or a malformed response yields an empty list and a log line, never a thrown error.
- [ ] The URL uses `current.json` with `toFixed(4)` coordinates, `lang=en`, and the shared contact User-Agent; the constant is generalized so it does not read as NWS-specific.
- [ ] The mapper reuses `str` and `byStartAscending` (no second copy), returns warnings ascending by start time, prefers `eventAwarenessName` then `event` for the type, prefers `description` then `title` for details and appends the instruction, and drops features with no type or no start time.
- [ ] No change to `index.ts`, `WeatherProviderAdapter`, the panel, or the schema (warnings ride the existing adapter seam); confirm the diff does not touch them.

## Hand-off

After this plan, `WarningsService` covers two regions: NWS for US waters, and Met.no MetAlerts for Norwegian waters. Any registered v2 provider serving a vessel in Norwegian and adjacent waters now returns real marine alerts (gale, wind, polar low, storm surge, and icing). This completes the Met.no provider family (current conditions, v2 forecasts, and warnings). Deferred politeness items, shared with phase 2: conditional `If-Modified-Since` polling honoring the MetAlerts `Expires` header, and a possible `geographicDomain=marine` filter if a future need calls for marine-only alerts. The remaining feature work is Plan 3, the synthesis merge engine, which blends the three independent providers' current conditions and forecasts (warnings stay region-sourced, independent of the merge).
