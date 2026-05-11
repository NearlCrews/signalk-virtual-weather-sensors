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
import { createMockWeatherData, getValuesFromDelta } from '../setup.js';

// Resolve the schema package by following the npm install path. The package
// ships its schemas under `schemas/`; loading the JSON directly bypasses the
// package's `main` (unrelated helpers).
const SCHEMA_PKG = '@signalk/signalk-schema';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, '..', '..', '..', 'node_modules', SCHEMA_PKG, 'schemas');

function loadSchema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf-8'));
}

/**
 * Read the full canonical 1.8.2 environment vocabulary directly from the
 * installed schema's `groups/environment.json`, so a future spec drop that
 * adds a leaf doesn't make this test produce false positives. Returns the
 * fully-qualified leaf paths under `environment.outside` and `environment.wind`.
 */
function loadCanonicalEnvLeaves(): ReadonlySet<string> {
  const env = loadSchema('groups/environment.json') as {
    properties?: {
      outside?: { properties?: Record<string, unknown> };
      wind?: { properties?: Record<string, unknown> };
    };
  };
  const outside = Object.keys(env.properties?.outside?.properties ?? {});
  const wind = Object.keys(env.properties?.wind?.properties ?? {});
  return new Set([
    ...outside.map((k) => `environment.outside.${k}`),
    ...wind.map((k) => `environment.wind.${k}`),
  ]);
}

const CANONICAL_ENV_LEAVES = loadCanonicalEnvLeaves();

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

    // The canonical meta sub-schema requires `description` on every entry,
    // but the 1.8.2 spec prose at data_model.html shows valid meta blocks
    // with just `units`/`displayName`, and the wider Signal K ecosystem
    // ships meta the same way. Drop the `description` requirement for the
    // meta-delta validator only; the values-delta validator stays strict.
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
 * is the escape hatch and is explicitly skipped.
 */
function collectVocabularyViolations(delta: ReturnType<NMEA2000PathMapper['mapToSignalKPaths']>) {
  const violations: string[] = [];
  for (const v of getValuesFromDelta(delta)) {
    const path = v.path as string;
    if (!path.startsWith('environment.outside.') && !path.startsWith('environment.wind.')) continue;
    if (!CANONICAL_ENV_LEAVES.has(path)) {
      violations.push(path);
    }
  }
  return violations;
}
