# Extract AccuWeather Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the reusable infrastructure welded into `AccuWeatherService` (the rolling quota window, the coalescing location cache, and the retrying HTTP client) into standalone, generic units, behavior-preserving, so a future keyed provider reuses them instead of forking the service.

**Architecture:** Three new generic modules under `src/services/` (`quota/RollingRequestWindow.ts`, `cache/CoalescingTtlCache.ts`, `http/RetryingHttpClient.ts`), plus folding the AccuWeather-private `readBoundedJson` into the existing `utils/http.ts` by adding a response-label parameter. `AccuWeatherService` composes these (constructs one of each, delegates to them) and shrinks from 958 lines to roughly 350, keeping only the AccuWeather-specific URL building, the location search, the field validation, and the orchestration. No runtime behavior changes: the emitted weather data, the retry/backoff/Retry-After semantics, the request counting, the quota gating, and the cache TTL/coalescing are identical; the only non-byte-identical aspect is some debug-level log wording, called out explicitly below.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- The three new modules must be GENERIC (no AccuWeather-specific knowledge): the quota window counts requests, the cache coalesces TTL lookups over a caller-supplied fetcher, and the HTTP client does a retrying GET. Provider-specific concerns (URL building, the location search, the User-Agent string, the response label) are passed in by `AccuWeatherService`.
- Determinism: the quota window and the cache must accept `now` as a parameter (defaulting to `Date.now()`) so their unit tests are wall-clock independent, the same pattern Plan 1.5 used for `ForecastCache`.
- SI units unchanged (this plan moves infrastructure, not weather math).
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Behavior-preserving: the existing `src/__tests__/services/AccuWeatherService.test.ts` (which mocks `fetch` and exercises the retry, timeout, 429/503/Retry-After, quota-window, and location-cache behavior) must pass UNCHANGED at every step. That suite is the regression net for the HTTP and cache semantics; new focused unit tests are added for the extracted units.
- Gate after every task: `npm run validate` (type-check including the panel, Biome with `noUnusedVariables: error`, full Vitest). The suite is at 446 tests; only add tests, never reduce the count.
- Commit type `refactor:` for every task.

---

### Task 1: Extract the rolling request window

**Files:**
- Create: `src/services/quota/RollingRequestWindow.ts`
- Modify: `src/services/AccuWeatherService.ts`
- Test: `src/__tests__/services/quota/RollingRequestWindow.test.ts` (create)

**Interfaces:**
- Produces: a generic `RollingRequestWindow` class owning the cumulative count and the 24 hourly buckets.
  - `constructor(now = Date.now())`
  - `record(now = Date.now()): void` (increments the cumulative count, then rotates, then increments the current-hour bucket; this reproduces `AccuWeatherService.ts:598-599` where `requestCount++` precedes `recordRequestInWindow()`)
  - `cumulativeCount(): number` (= the old `getRequestCount`)
  - `countLast24h(now = Date.now()): number` (rotates, then sums the buckets; = the old `getRequestCountLast24h`)
  - private `rotate(now)` (= the old `rotateRequestWindow`, with `now` injected instead of reading `Date.now()`)
  - The constants `REQUEST_WINDOW_HOURS` (24) and `HOUR_MS` move into this module.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services/quota/RollingRequestWindow.test.ts
import { describe, expect, it } from 'vitest';
import { RollingRequestWindow } from '../../../services/quota/RollingRequestWindow.js';

const HOUR = 60 * 60 * 1000;

describe('RollingRequestWindow', () => {
  it('counts cumulative and last-24h within one hour', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    w.record(0);
    expect(w.cumulativeCount()).toBe(2);
    expect(w.countLast24h(0)).toBe(2);
  });
  it('ages requests out of the 24h window but keeps the cumulative count', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    // 24 hours later the bucket has rotated out of the window.
    expect(w.countLast24h(24 * HOUR)).toBe(0);
    expect(w.cumulativeCount()).toBe(1);
  });
  it('zeros the window on a backward clock jump', () => {
    const w = new RollingRequestWindow(10 * HOUR);
    w.record(10 * HOUR);
    expect(w.countLast24h(5 * HOUR)).toBe(0);
  });
  it('keeps requests from the last 23 hours in the window', () => {
    const w = new RollingRequestWindow(0);
    w.record(0);
    expect(w.countLast24h(23 * HOUR)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/quota/RollingRequestWindow.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `RollingRequestWindow.ts`**

Move `requestCount`, `requestWindow`, `requestWindowCurrentHour`, `rotateRequestWindow`, and `recordRequestInWindow` from `AccuWeatherService` into the class, with `now` injected. `record(now)` does `this.cumulative++; this.rotate(now); this.buckets[REQUEST_WINDOW_HOURS - 1] = (this.buckets[REQUEST_WINDOW_HOURS - 1] ?? 0) + 1;` (the cumulative-then-bucket order matches the original). Keep the doc comments (the bucket-rotation explanation, the backward-jump rationale). Move `REQUEST_WINDOW_HOURS` and `HOUR_MS` into the file.

- [ ] **Step 4: Rewire `AccuWeatherService.ts`**

Add a `private readonly requestWindow = new RollingRequestWindow();` field (replacing the `requestCount`/`requestWindow`/`requestWindowCurrentHour` fields and the `rotateRequestWindow`/`recordRequestInWindow` methods). In `makeApiRequest`, replace the two lines `this.requestCount++; this.recordRequestInWindow();` with `this.requestWindow.record();`. Make `getRequestCount()` return `this.requestWindow.cumulativeCount()` and `getRequestCountLast24h()` return `this.requestWindow.countLast24h()`. Add the import. Remove the moved `REQUEST_WINDOW_HOURS` and `HOUR_MS` constants from the service. After the move, any surviving service comment that referenced those names by text (the bucket-index explanation) is a dangling reference, so update those comments to read against the value (24) or to point at `RollingRequestWindow`. Biome does not lint comments, so this is for accuracy, not the gate.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeatherService quota tests (request counting, the rolling-24h window) pass unchanged, plus the new window tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/quota/RollingRequestWindow.ts src/services/AccuWeatherService.ts src/__tests__/services/quota/RollingRequestWindow.test.ts
git commit -m "refactor: extract the rolling request window into a reusable unit"
```

---

### Task 2: Extract the coalescing TTL cache

**Files:**
- Create: `src/services/cache/CoalescingTtlCache.ts`
- Modify: `src/services/AccuWeatherService.ts`
- Test: `src/__tests__/services/cache/CoalescingTtlCache.test.ts` (create)

**Interfaces:**
- Produces: a generic `CoalescingTtlCache<V>` class owning the entry map, the in-flight map, and the prune throttle. It uses the shared `evictOldestOverCap` from `./cacheUtils.js` (Plan 1.5).
  - `constructor(ttlMs: number, pruneIntervalMs: number, logger: Logger = () => {}, now = Date.now())`
  - `get(key: string, fetch: () => Promise<V>, now = Date.now()): Promise<V>` (throttled prune, fresh-hit return, else coalesced fetch + store with timestamp; reproduces `getLocationKey` plus `searchLocationCoalesced` plus the read-path freshness check)
  - `peekStale(key: string): V | undefined` (returns the stored value ignoring expiry AND without pruning; the explicit name makes the TTL-bypass visible at the call site so a future consumer cannot read stale data by accident. Reproduces `getCachedLocationKey`'s expiry-agnostic, prune-free read. It must NOT call `prune`.)
  - `size(): number`, `clear(): void`
  - private `coalesced(key, fetch)` (single-flight via the in-flight map, clearing on settle) and `prune(now)` (throttle on `pruneIntervalMs`, evict entries older than `ttlMs`, then `evictOldestOverCap`)

Note on logging: the old `getLocationKey`/`pruneLocationCache` emitted AccuWeather-flavored debug logs ("Using cached location key", "Location key retrieved and cached", "Location cache pruned" with `locationName`/`cacheSize` detail). The generic cache emits generic debug logs instead (for example "cache hit", "cache store", "cache pruned" with the entry count). This is the ONE non-byte-identical change in this plan: it is debug-level only, not asserted by any test, and not visible to data consumers. Call it out in the commit body by WHAT changed (generic cache debug wording), not how.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services/cache/CoalescingTtlCache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CoalescingTtlCache } from '../../../services/cache/CoalescingTtlCache.js';

describe('CoalescingTtlCache', () => {
  it('returns a fresh hit without refetching', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    const fetch = vi.fn(async () => 'a');
    expect(await c.get('k', fetch, 0)).toBe('a');
    expect(await c.get('k', fetch, 500)).toBe('a');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refetches after the ttl expires', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    expect(await c.get('k', async () => 'a', 0)).toBe('a');
    expect(await c.get('k', async () => 'b', 2000)).toBe('b');
  });
  it('coalesces concurrent cold lookups onto a single fetch', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    let calls = 0;
    const fetch = async () => {
      calls++;
      await Promise.resolve();
      return 'a';
    };
    const [r1, r2] = await Promise.all([c.get('k', fetch, 0), c.get('k', fetch, 0)]);
    expect(r1).toBe('a');
    expect(r2).toBe('a');
    expect(calls).toBe(1);
  });
  it('peekStale returns a stored value ignoring expiry, undefined when absent', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    expect(c.peekStale('k')).toBeUndefined();
    await c.get('k', async () => 'a', 0);
    // Well past the ttl: peekStale still returns the value (the bypass it is named for).
    expect(c.peekStale('k')).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/cache/CoalescingTtlCache.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `CoalescingTtlCache.ts`**

Move the entry map, the in-flight map, the prune throttle, `searchLocationCoalesced` (renamed `coalesced`, parameterized over the fetcher), and `pruneLocationCache` (renamed `prune`, with `now` injected and `maxAgeMs = this.ttlMs`) into the generic class. `get` reproduces the `getLocationKey` body: `prune(now)`, fresh-hit check (`now - entry.timestamp < ttlMs`), else `coalesced(key, fetch)` and store with `{ value, timestamp: now }`. Import `evictOldestOverCap` from `./cacheUtils.js`. Use generic debug log wording.

- [ ] **Step 4: Rewire `AccuWeatherService.ts`**

Replace the `locationCache`, `lastCachePrune`, and `inFlightLocationSearch` fields with `private readonly locationCache = new CoalescingTtlCache<AccuWeatherLocation>(this.config.locationCacheTimeout * 1000, CACHE_PRUNE_INTERVAL_MS, this.logger);` (construct it in the constructor since it reads `this.config`). Rewrite:
- `getLocationKey(location)` to `return (await this.locationCache.get(this.locationCacheKey(location), () => this.searchLocation(location))).Key;`
- `getCachedLocationKey(location)` to `return this.locationCache.peekStale(this.locationCacheKey(location))?.Key;` (note `?.Key` directly on the returned `AccuWeatherLocation`: the cache stores the value directly, so do NOT carry the old `?.location.Key` double-deref)
- `clearLocationCache()` to call `this.locationCache.clear()` (plus `this.forecastCache.clear()` as today)
- `getCacheStats()` to `return { size: this.locationCache.size() };`
Remove the moved methods (`pruneLocationCache`, `searchLocationCoalesced`) and the `CACHE_PRUNE_INTERVAL_MS` constant (it moves into `CoalescingTtlCache`'s caller, so the service passes it as the `pruneIntervalMs` argument; keep the constant only if the service still references it, otherwise move it). Keep `locationCacheKey` and `searchLocation` in the service (AccuWeather-specific). Add the `CoalescingTtlCache` import, and REMOVE the `evictOldestOverCap` import line (`AccuWeatherService.ts:41`): after this task `evictOldestOverCap` is used only inside `CoalescingTtlCache` and `ForecastCache`, not the service, so the service's import is now unused and Biome `noUnusedVariables: error` would fail if it is left.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeatherService location-cache and coalescing tests pass unchanged (same TTL, same single-flight behavior), plus the new cache tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/cache/CoalescingTtlCache.ts src/services/AccuWeatherService.ts src/__tests__/services/cache/CoalescingTtlCache.test.ts
git commit -m "refactor: extract the coalescing TTL cache into a reusable unit" -m "CoalescingTtlCache and ForecastCache stay separate on purpose: the forecast cache serves stale data on quota exhaustion and takes a rate-limit error factory, which the single-flight coalescing cache does not, so they are not duplicates to merge. The location cache debug log wording becomes generic (cache hit, cache store, cache pruned)."
```

---

### Task 3: Fold the bounded-JSON read into the shared HTTP util

**Files:**
- Modify: `src/utils/http.ts` (add a response-label parameter to `readBoundedJson`)
- Modify: `src/services/AccuWeatherService.ts` (use the shared `readBoundedJson`, delete the private copy)
- Test: `src/__tests__/utils/http.test.ts` (extend if it exists; otherwise add a focused assertion)

**Interfaces:**
- Consumes: nothing new.
- Produces: `readBoundedJson<T>(response, maxBytes?, label = 'response'): Promise<T>` in `utils/http.ts`. The `label` is interpolated into the over-size and parse-failure messages (`${label} is ${n} bytes (max ...)` and `failed to parse ${label} as JSON`). The default `'response'` preserves the keyless callers' current messages; AccuWeather passes `'AccuWeather response'` to preserve its exact strings.

The AccuWeather private `readBoundedJson` (`AccuWeatherService.ts:652-682`) is byte-identical to the shared one except the messages say "AccuWeather response" and it uses the service-local `MAX_RESPONSE_BYTES`. The shared default `DEFAULT_MAX_RESPONSE_BYTES` is the same value (1 MiB), so passing the label reproduces the AccuWeather messages exactly.

- [ ] **Step 1: Add the label parameter to `utils/http.ts`**

```ts
export async function readBoundedJson<T>(
  response: Response,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES,
  label = 'response'
): Promise<T> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: ${label} is ${declared} bytes (max ${maxBytes})`
      );
    }
  }
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error(
      `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: ${label} is ${text.length} characters (max ${maxBytes})`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: failed to parse ${label} as JSON - ${toErrorMessage(error)}`
    );
  }
}
```

`fetchJson` keeps calling `readBoundedJson<T>(response, maxBytes)` (label defaults to `'response'`, unchanged).

- [ ] **Step 2: Use it in `AccuWeatherService.ts`**

Delete the private `readBoundedJson` method. Import `readBoundedJson` from `../utils/http.js`. Replace the two call sites (`makeApiRequest`'s success read at `AccuWeatherService.ts:609` and `handleApiError`'s error-body read at `:725`) with `readBoundedJson<T>(response, MAX_RESPONSE_BYTES, 'AccuWeather response')` (and the `{ message?: string }` type in handleApiError). Keep the explicit `MAX_RESPONSE_BYTES` argument: it preserves the exact "(max 1048576)" text without depending on the util default.

Pin the label so the regression net actually covers it. The existing AccuWeather over-size test (in `src/__tests__/services/AccuWeatherService.test.ts`, the one asserting `/RESPONSE_TOO_LARGE/`) checks only the error-code prefix, so the label is currently unprotected. Strengthen that test by adding `/AccuWeather response/` to its thrown-message matcher (add the assertion, do not replace the existing one). Include `src/__tests__/services/AccuWeatherService.test.ts` in this task's git add.

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: green. Any existing test asserting the AccuWeather over-size or parse-failure message still passes (the label reproduces "AccuWeather response"); the keyless `fetchJson` messages are unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/utils/http.ts src/services/AccuWeatherService.ts src/__tests__/services/AccuWeatherService.test.ts
git commit -m "refactor: fold the AccuWeather bounded-JSON read into the shared http util"
```

(There is no `src/__tests__/utils/http.test.ts` today; the strengthened AccuWeatherService over-size test pins the AccuWeather-label path.)

---

### Task 4: Extract the retrying HTTP client

**Files:**
- Create: `src/services/http/RetryingHttpClient.ts`
- Modify: `src/services/AccuWeatherService.ts`
- Test: `src/__tests__/services/http/RetryingHttpClient.test.ts` (create)

**Interfaces:**
- Consumes: `readBoundedJson` from `../../utils/http.js` (Task 3); `RollingRequestWindow.record` indirectly via the `onRequestCounted` hook (Task 1).
- Produces: a generic `RetryingHttpClient` class.
  - `constructor(options: { requestTimeoutMs: number; retryAttempts: number; retryDelayMs: number; userAgent: string; onRequestCounted?: () => void; logger?: Logger; maxResponseBytes?: number; responseLabel?: string })`. The client supplies its own defaults: `maxResponseBytes` defaults to the shared `DEFAULT_MAX_RESPONSE_BYTES` (1 MiB), `responseLabel` to `'response'`, `logger` to a no-op, `onRequestCounted` to a no-op.
  - `request<T>(url: URL, attempt = 1): Promise<T>` (the old `makeApiRequest` body VERBATIM, KEEPING the `attempt` recursion parameter: the body recurses with `this.request<T>(url, attempt + 1)` and passes `attempt` to `handleApiError(response, attempt)` and `throwRetryableStatus(attempt, ...)`. Public callers pass `request(url)`; the `attempt = 1` default seeds the recursion. Includes the retry recursion, the abort-timeout armed across the body read, the Retry-After honoring, and calling `onRequestCounted` after the response lands and before the `!response.ok` check, matching `AccuWeatherService.ts:598-603`.)
  - private `parseRetryAfter`, `handleApiError`, `throwRetryableStatus`, `sanitizeUrlForLogging`, `isRetryableError`, `delay`, all moved verbatim. The constants `RETRYABLE_ERROR_SUBSTRINGS`, `MAX_RETRY_AFTER_MS`, and the response-bytes cap move into this module (or are passed via options).

This is the highest-risk task: the retry/backoff/Retry-After/abort semantics must be byte-identical. Move the methods verbatim, changing only `this.config.requestTimeout` to `this.requestTimeoutMs`, `this.config.retryAttempts` to `this.retryAttempts`, `this.config.retryDelay` to `this.retryDelayMs`, the User-Agent literal to `this.userAgent`, and inserting `this.onRequestCounted?.()` where the old code did `this.requestCount++; this.recordRequestInWindow();` (line 598-599, after `fetch` resolves and before the `!response.ok` check).

BOTH `readBoundedJson` call sites must pass the cap and the label, not just the error-body one: the success read (old line 609, was `this.readBoundedJson<T>(response)`) becomes `readBoundedJson<T>(response, this.maxResponseBytes, this.responseLabel)`, and `handleApiError`'s error-body read (old line 725) becomes `readBoundedJson<{ message?: string }>(response, this.maxResponseBytes, this.responseLabel)`. Do not leave the success read argument-less, or it silently falls back to the util's default `'response'` label on a success-path over-size error.

Relative-import note: the new module lives at `src/services/http/`, one level deeper than the service, so its imports to `utils`/`constants` use `../../`, not `../`: `readBoundedJson` from `../../utils/http.js`, `toErrorMessage` from `../../utils/conversions.js`, `ERROR_CODES` from `../../constants/index.js`, and `Logger` from `../../types/index.js`. (`PLUGIN` is NOT imported here: the User-Agent string is built by the service and passed in as `userAgent`, so `PLUGIN` stays in the service.)

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services/http/RetryingHttpClient.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryingHttpClient } from '../../../services/http/RetryingHttpClient.js';

// Match the suite's fetch-mock idiom (AccuWeatherService.test.ts:26-34): stub the
// global fetch in beforeEach, unstub in afterEach. Do NOT use vi.spyOn here.
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

// Minimal Response stand-in covering what readBoundedJson reads: headers.get and text().
// Model on the existing AccuWeatherService.test.ts mockResponse helper if it differs.
function mockResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  const status = init?.status ?? 200;
  return {
    ok: status < 400,
    status,
    statusText: init?.statusText ?? 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeClient(onRequestCounted?: () => void): RetryingHttpClient {
  return new RetryingHttpClient({
    requestTimeoutMs: 1000,
    retryAttempts: 3,
    retryDelayMs: 1,
    userAgent: 'test/1.0',
    onRequestCounted,
  });
}

describe('RetryingHttpClient', () => {
  it('returns parsed JSON and fires onRequestCounted once per landed response', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ ok: 1 }));
    const result = await makeClient(onRequestCounted).request<{ ok: number }>(
      new URL('https://example.test/x')
    );
    expect(result).toEqual({ ok: 1 });
    expect(onRequestCounted).toHaveBeenCalledTimes(1);
  });
  it('counts a 503 error response too, then retries and succeeds', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockResponse({}, { status: 503, statusText: 'unavailable' }))
      .mockResolvedValueOnce(mockResponse({ ok: 2 }));
    const result = await makeClient(onRequestCounted).request<{ ok: number }>(
      new URL('https://example.test/x')
    );
    expect(result).toEqual({ ok: 2 });
    // Both landed responses are counted: an error response from the upstream still
    // consumed quota, so onRequestCounted fires on the 503 AND the 200.
    expect(onRequestCounted).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
```

(Model the mock on the existing `AccuWeatherService.test.ts` fetch-mocking setup if `new Response` is not available in the test environment; the existing suite already mocks `fetch`, so reuse its idiom.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/http/RetryingHttpClient.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `RetryingHttpClient.ts`**

Move `makeApiRequest` (as `request`), `parseRetryAfter`, `handleApiError`, `throwRetryableStatus`, `sanitizeUrlForLogging`, `isRetryableError`, and `delay` verbatim, with the field substitutions named above. Move `RETRYABLE_ERROR_SUBSTRINGS` and `MAX_RETRY_AFTER_MS`. Import `readBoundedJson` from `../../utils/http.js`, `ERROR_CODES` from the constants, and `toErrorMessage` from conversions. The `onRequestCounted?.()` call goes exactly where `requestCount++`/`recordRequestInWindow()` were: after `fetch` resolves, before the `!response.ok` check.

- [ ] **Step 4: Rewire `AccuWeatherService.ts`**

Construct the client in the constructor: `this.http = new RetryingHttpClient({ requestTimeoutMs: this.config.requestTimeout, retryAttempts: this.config.retryAttempts, retryDelayMs: this.config.retryDelay, userAgent: \`${PLUGIN.NAME}/${PLUGIN.VERSION}\`, onRequestCounted: () => this.requestWindow.record(), logger: this.logger, maxResponseBytes: MAX_RESPONSE_BYTES, responseLabel: 'AccuWeather response' });`. Replace every `this.makeApiRequest<T>(url)` call (in `fetchHourlyForecast`, `fetchDailyForecast`, `searchLocation`, `getCurrentConditions`) with `this.http.request<T>(url)`. Remove the moved methods and constants from the service. The service keeps `buildApiUrl`/`buildLocationKeyUrl`/`buildForecastUrl` (URL construction) and `searchLocation`/`getCurrentConditions` (which now call `this.http.request`). Drop now-unused service imports (the gate flags them).

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeatherService HTTP tests (retry, timeout, 401/403/404/429/503, Retry-After honoring, request counting) pass UNCHANGED, which is the proof that the retry semantics are byte-identical, plus the new client tests. Confirm `wc -l src/services/AccuWeatherService.ts` is roughly 350 or fewer.

- [ ] **Step 6: Commit**

```bash
git add src/services/http/RetryingHttpClient.ts src/services/AccuWeatherService.ts src/__tests__/services/http/RetryingHttpClient.test.ts
git commit -m "refactor: extract the retrying HTTP client into a reusable unit"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 446 plus the new window, cache, and client tests).
- [ ] `wc -l src/services/AccuWeatherService.ts` is roughly 350 or fewer; `ls src/services/quota src/services/http` show `RollingRequestWindow.ts` and `RetryingHttpClient.ts`, and `src/services/cache/` has `CoalescingTtlCache.ts`.
- [ ] `git grep -n "private readBoundedJson\|function makeApiRequest\|recordRequestInWindow\|searchLocationCoalesced" src/services/AccuWeatherService.ts` returns nothing (all moved).
- [ ] The three new modules contain no AccuWeather-specific identifier (no `ACCUWEATHER`, no `apikey`, no location-key logic); they are generic. (`sanitizeUrlForLogging` stripping `apikey` is generic URL hygiene, which is acceptable in the HTTP client.)
- [ ] The existing `AccuWeatherService.test.ts` passes unchanged, proving the retry/backoff/Retry-After/quota/cache behavior is preserved.
- [ ] No runtime behavior changed except the documented debug-log wording in the location cache.

## Hand-off

After this extraction, a future keyed provider constructs a `RetryingHttpClient`, a `RollingRequestWindow`, and a `CoalescingTtlCache` rather than copying the AccuWeather fetch path. `AccuWeatherService` is a thin orchestrator over those plus its AccuWeather-specific URL building, location search, and field validation. This completes the modularization roadmap's structural items (9 and 10); the remaining roadmap items are documentation-and-test follow-ons, and the feature work is Plan 2 (Open-Meteo v2 parity) and Plan 3 (the synthesis merge engine).
