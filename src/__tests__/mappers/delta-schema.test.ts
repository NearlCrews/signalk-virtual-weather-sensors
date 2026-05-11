/**
 * Signal K Delta Schema Conformance Tests
 *
 * Validates the deltas this plugin emits against the canonical Signal K 1.8.2
 * JSON Schema published in `@signalk/signalk-schema` v1.8.2 (the npm version
 * matches the spec version used elsewhere in this project: see CLAUDE.md
 * "Signal K Spec Compliance (1.8.2)" and the project package.json
 * `peerDependencies.@signalk/server-api ">=2.24.0"`).
 *
 * The goal is to catch wire-format regressions before they reach a real
 * Signal K server. Two surfaces are checked:
 *   1. The values delta produced by `mapper.mapToSignalKPaths(...)`, with both
 *      the minimal `createMockWeatherData()` fixture and the enhanced fixture
 *      (every optional AccuWeather field populated).
 *   2. The one-shot meta delta produced by `mapper.buildMetaDelta()`.
 *
 * It also asserts the canonical-vocabulary subset of the path strings against
 * the 1.8.2 `groups/environment.json` group schema (only the `environment.outside`
 * and `environment.wind` leaves the spec actually defines: anything this plugin
 * emits under the producer-namespaced `environment.weather.*` branch is
 * intentionally non-canonical and is skipped, see CLAUDE.md and the v1.4.0
 * CHANGELOG entry).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { NMEA2000PathMapper } from '../../mappers/NMEA2000PathMapper.js';
import { createMockWeatherData } from '../setup.js';

// Resolve the schema package by following the npm install path. We deliberately
// load JSON files rather than importing from the package's `main`: the package
// ships its schemas under `schemas/` and the `main` entry exports unrelated
// helpers that are not needed for schema validation.
const SCHEMA_PKG = '@signalk/signalk-schema';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Walk up from the test file to the project root, then into node_modules.
// The test file lives at src/__tests__/mappers/, so the root is three levels up.
const SCHEMA_DIR = join(__dirname, '..', '..', '..', 'node_modules', SCHEMA_PKG, 'schemas');

function loadSchema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf-8'));
}

/**
 * Canonical 1.8.2 environment leaves we expect to find in our values deltas.
 * Source: `@signalk/signalk-schema@1.8.2/schemas/groups/environment.json`,
 * the `outside` and `wind` blocks. Hand-encoded as a constant so the test
 * fails loudly if a future spec drop renames a leaf without our noticing.
 * See https://signalk.org/specification/1.8.2/doc/vesselsBranch.html
 * for the published vocabulary.
 */
const CANONICAL_ENV_LEAVES: ReadonlySet<string> = new Set([
  // environment.outside.*
  'environment.outside.temperature',
  'environment.outside.dewPointTemperature',
  'environment.outside.apparentWindChillTemperature',
  'environment.outside.heatIndexTemperature',
  'environment.outside.pressure',
  'environment.outside.relativeHumidity',
  // environment.wind.*
  'environment.wind.speedOverGround',
  'environment.wind.directionTrue',
  'environment.wind.speedApparent',
  'environment.wind.angleApparent',
]);

describe('Signal K Delta Schema Conformance (1.8.2)', () => {
  let ajv: Ajv;
  let validateValuesDelta: ReturnType<Ajv['compile']>;
  let validateMetaDelta: ReturnType<Ajv['compile']>;
  let mapper: NMEA2000PathMapper;

  beforeAll(() => {
    // The 1.8.2 schemas declare `$schema: draft-04`, so we use the dedicated
    // ajv-draft-04 entry point. Vanilla Ajv 8 defaults to draft-07 which
    // accepts most of the schema but fails on draft-04 idioms like the bare
    // `id` keyword used at the top of every schema file.
    ajv = new Ajv({
      allErrors: true,
      strict: false, // schemas use `example`, `quantity`, etc. that aren't in the JSON Schema vocab
    });
    addFormats(ajv);

    const deltaSchema = loadSchema('delta.json') as Record<string, unknown>;
    const definitionsSchema = loadSchema('definitions.json') as Record<string, unknown>;

    // The delta schema $refs `./definitions.json#/definitions/sourceRef` etc.
    // Register definitions under that exact relative URI so the refs resolve.
    ajv.addSchema(definitionsSchema, './definitions.json');

    validateValuesDelta = ajv.compile(deltaSchema);

    // -- META DELTA WORKAROUND ----------------------------------------------
    // The canonical `definitions.json#/definitions/meta` requires
    // `description` on every meta entry. The 1.8.2 prose
    // (https://signalk.org/specification/1.8.2/doc/data_model.html) does NOT
    // mandate `description`: the example shows `units` and `displayName`
    // alone as a valid meta block. The strict JSON Schema is therefore at
    // odds with the spec text, and the wider Signal K ecosystem ships meta
    // updates without `description` (the schema bug is tracked upstream but
    // unresolved as of @signalk/signalk-schema 1.8.2).
    //
    // For our meta-delta validation we use a relaxed copy of the schema
    // where the meta value object's `required: ['description']` array is
    // rebuilt without `description`. We still validate the envelope, the
    // path string, and every other meta sub-field against the canonical
    // schema. If upstream tightens their meta requirements we will re-enable
    // the strict check by dropping the relaxed clone.
    //
    // JSON Schema (draft-04) forbids an empty `required` array, so when the
    // filter removes the only element we omit the key from the rebuilt meta
    // sub-schema entirely (object spread with the property excluded).
    const definitionsClone = JSON.parse(JSON.stringify(definitionsSchema)) as {
      definitions: { meta: Record<string, unknown> & { required?: string[] } };
    };
    const originalRequired = definitionsClone.definitions.meta.required ?? [];
    const filteredRequired = originalRequired.filter((k) => k !== 'description');
    const { required: _omit, ...metaWithoutRequired } = definitionsClone.definitions.meta;
    definitionsClone.definitions.meta =
      filteredRequired.length > 0
        ? { ...metaWithoutRequired, required: filteredRequired }
        : metaWithoutRequired;

    const relaxedAjv = new Ajv({ allErrors: true, strict: false });
    addFormats(relaxedAjv);
    relaxedAjv.addSchema(definitionsClone, './definitions.json');
    validateMetaDelta = relaxedAjv.compile(deltaSchema);

    mapper = new NMEA2000PathMapper();
  });

  describe('mapToSignalKPaths -> values delta', () => {
    it('conforms to delta.json with the minimal mock weather payload', () => {
      const delta = mapper.mapToSignalKPaths(createMockWeatherData());

      const ok = validateValuesDelta(delta);
      expect(validateValuesDelta.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });

    it('conforms to delta.json with the fully enhanced weather payload', () => {
      const delta = mapper.mapToSignalKPaths(
        createMockWeatherData({
          // Enhanced temperature readings
          realFeelShade: 291.15,
          wetBulbTemperature: 289.15,
          wetBulbGlobeTemperature: 290.15,
          apparentTemperature: 294.15,

          // Enhanced wind data
          windGustSpeed: 8.5,
          windGustFactor: 1.65,
          beaufortScale: 4,
          apparentWindSpeed: 6.2,
          apparentWindAngle: 0.524, // ~30 degrees in radians

          // Atmospheric conditions
          uvIndex: 5.2,
          visibility: 15000,
          cloudCover: 0.8,
          cloudCeiling: 1200,

          // Calculated values
          absoluteHumidity: 0.012,
          airDensityEnhanced: 1.205,
          heatStressIndex: 1,
          temperatureDeparture24h: 2.5,

          // Precipitation
          precipitationLastHour: 0.5,
          precipitationCurrent: 0.2,
        })
      );

      const ok = validateValuesDelta(delta);
      expect(validateValuesDelta.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });

    it('emits a context that satisfies the schema (string)', () => {
      const delta = mapper.mapToSignalKPaths(createMockWeatherData());
      expect(typeof delta.context).toBe('string');
      expect(delta.context).toBe('vessels.self');
    });

    it('emits exactly one update with $source and timestamp on every values delta', () => {
      const delta = mapper.mapToSignalKPaths(createMockWeatherData());
      expect(delta.updates).toHaveLength(1);
      const update = delta.updates[0];
      expect(update).toBeDefined();
      // Narrow the union so the delta-schema oneOf arm is the values arm.
      if (!update || !('values' in update)) {
        throw new Error('expected a values update');
      }
      expect(update.$source).toBe('accuweather');
      expect(typeof update.timestamp).toBe('string');
      // RFC 3339 UTC: definitions.json `timestamp` requires the trailing Z.
      expect(update.timestamp).toMatch(/Z$/);
    });
  });

  describe('buildMetaDelta -> meta delta', () => {
    it('conforms to delta.json (meta-update arm) with relaxed meta-description requirement', () => {
      const meta = mapper.buildMetaDelta();

      const ok = validateMetaDelta(meta);
      expect(validateMetaDelta.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });

    it('routes meta entries through the meta arm of the update union (no values key)', () => {
      const meta = mapper.buildMetaDelta();
      expect(meta.updates).toHaveLength(1);
      const update = meta.updates[0];
      expect(update).toBeDefined();
      if (!update || !('meta' in update)) {
        throw new Error('expected a meta update');
      }
      expect(Array.isArray(update.meta)).toBe(true);
      expect(update.meta.length).toBeGreaterThan(0);
      // The schema's oneOf forbids both `values` and `meta` on the same arm
      // unless both are present together: our buildMetaDelta uses the meta-only arm.
      expect('values' in update).toBe(false);
    });

    it('every meta entry has a string path and an object value', () => {
      const meta = mapper.buildMetaDelta();
      const update = meta.updates[0];
      if (!update || !('meta' in update)) {
        throw new Error('expected a meta update');
      }
      for (const entry of update.meta) {
        expect(typeof entry.path).toBe('string');
        expect(entry.path.length).toBeGreaterThan(0);
        expect(typeof entry.value).toBe('object');
        expect(entry.value).not.toBeNull();
      }
    });
  });

  describe('Path vocabulary (1.8.2 environment group)', () => {
    it('every emitted environment.outside.* and environment.wind.* path is in the canonical vocabulary', () => {
      const delta = mapper.mapToSignalKPaths(
        createMockWeatherData({
          // Force every optional canonical-or-namespaced field to be emitted.
          apparentWindSpeed: 6.2,
          apparentWindAngle: 0.524,
          airDensityEnhanced: 1.205,
        })
      );
      const violations = collectVocabularyViolations(delta);
      expect(violations).toEqual([]);
    });
  });
});

/**
 * Walk the values delta and collect every path that lives under a canonical
 * leaf-only container (`environment.outside.*`, `environment.wind.*`) but is
 * not in the 1.8.2 vocabulary. The producer namespace `environment.weather.*`
 * and the spec-defined-but-out-of-our-canonical-set `environment.outside.airDensity`
 * are explicitly skipped.
 */
function collectVocabularyViolations(delta: ReturnType<NMEA2000PathMapper['mapToSignalKPaths']>) {
  const update = delta.updates[0];
  if (!update || !('values' in update)) {
    throw new Error('expected a values update');
  }
  const violations: string[] = [];
  for (const v of update.values) {
    if (isUncheckedPath(v.path as string)) continue;
    if (!CANONICAL_ENV_LEAVES.has(v.path as string)) {
      violations.push(v.path as string);
    }
  }
  return violations;
}

function isUncheckedPath(path: string): boolean {
  if (path === 'environment.outside.airDensity') return true;
  if (path.startsWith('environment.weather.')) return true;
  return !path.startsWith('environment.outside.') && !path.startsWith('environment.wind.');
}
