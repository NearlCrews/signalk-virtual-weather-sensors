/**
 * SignalK navigation-data accessor with caching and source-exclusion logic.
 * Wraps `getSelfPath` calls so the rest of the plugin sees normalized values.
 */

import type { ServerAPI } from '@signalk/server-api';
import { SIGNALK_PATHS, VALIDATION_LIMITS } from '../constants/index.js';
import type { GeoLocation, Logger, PluginState, VesselNavigationData } from '../types/index.js';
import {
  elapsedSinceMs,
  isValidBearing,
  isValidCoordinates,
  isValidVesselSpeed,
  normalizeAngle0To2Pi,
  toErrorMessage,
} from '../utils/conversions.js';

const NAV = SIGNALK_PATHS.NAVIGATION;

/**
 * Source labels (lowercased) whose data we deliberately ignore to avoid
 * feedback loops. Substring match, so `'node-red'` covers `'signalk-node-red'`.
 */
const EXCLUDED_SOURCE_LABELS: ReadonlyArray<string> = ['node-red'];

interface SignalKDataValue {
  value: unknown;
  timestamp?: string;
  /**
   * `app.getSelfPath` returns a full-model leaf whose source identity is the
   * string `$source` (a SourceRef such as `signalk-node-red.123`), not a
   * nested `source` object. Matched as a lowercased substring by
   * `isExcludedSource`.
   */
  $source?: string;
}

interface TimedReading<T> {
  readonly value: T | null;
  readonly timestampMs: number | null;
}

const EMPTY_READING: TimedReading<never> = Object.freeze({ value: null, timestampMs: null });

/**
 * Snapshot of vessel navigation data. `readonly` enforces the replace-wholesale
 * invariant documented on EMPTY_CACHED_VESSEL_DATA: the cache is never mutated
 * in place, only swapped for a fresh object.
 */
interface CachedVesselData {
  readonly position: GeoLocation | null;
  readonly speedOverGround: number | null;
  readonly courseOverGroundTrue: number | null;
  readonly headingTrue: number | null;
  readonly headingMagnetic: number | null;
  readonly magneticVariation: number | null;
  /** Oldest accepted source measurement timestamp in the snapshot. */
  readonly lastUpdateMs: number | null;
}

/**
 * All-null cache state. Shared by the field initializer and `clearCache()`:
 * `cachedData` is only ever replaced wholesale, never mutated in place, so a
 * single frozen instance is safe.
 */
const EMPTY_CACHED_VESSEL_DATA: CachedVesselData = Object.freeze({
  position: null,
  speedOverGround: null,
  courseOverGroundTrue: null,
  headingTrue: null,
  headingMagnetic: null,
  magneticVariation: null,
  lastUpdateMs: null,
});

export class SignalKService {
  private readonly app: ServerAPI;
  private readonly logger: Logger;
  private readonly maxDataAge = VALIDATION_LIMITS.MAX_DATA_AGE;

  private cachedData: CachedVesselData = EMPTY_CACHED_VESSEL_DATA;

  constructor(app: ServerAPI, logger: Logger = () => {}) {
    this.app = app;
    this.logger = logger;

    this.logger('info', 'SignalKService initialized', {
      maxDataAge: this.maxDataAge,
    });
  }

  public getVesselNavigationData(): VesselNavigationData {
    const position = this.readPosition();
    const speedOverGround = this.readNumericSelfPath(
      NAV.SPEED_OVER_GROUND,
      isValidVesselSpeed,
      'speed over ground'
    );
    const magneticVariation = this.readNumericSelfPath(
      NAV.MAGNETIC_VARIATION,
      (variation) => Math.abs(variation) <= Math.PI,
      'magnetic variation'
    );
    const courseTrue = this.readNumericSelfPath(
      NAV.COURSE_OVER_GROUND_TRUE,
      isValidBearing,
      'course over ground (true)'
    );
    const courseMagnetic = this.readNumericSelfPath(
      NAV.COURSE_OVER_GROUND_MAGNETIC,
      isValidBearing,
      'course over ground (magnetic)'
    );
    const headingTrue = this.readNumericSelfPath(
      NAV.HEADING_TRUE,
      isValidBearing,
      'heading (true)'
    );
    const headingMagnetic = this.readNumericSelfPath(
      NAV.HEADING_MAGNETIC,
      isValidBearing,
      'heading (magnetic)'
    );

    const correctedCourseMagnetic = this.correctMagneticReading(
      courseMagnetic,
      magneticVariation,
      'course over ground'
    );
    const correctedHeadingMagnetic = this.correctMagneticReading(
      headingMagnetic,
      magneticVariation,
      'heading'
    );
    const resolvedHeadingTrue = headingTrue.value !== null ? headingTrue : correctedHeadingMagnetic;
    const resolvedCourseTrue =
      courseTrue.value !== null
        ? courseTrue
        : correctedCourseMagnetic.value !== null
          ? correctedCourseMagnetic
          : resolvedHeadingTrue;

    const acceptedTimestamps = [
      position,
      speedOverGround,
      resolvedCourseTrue,
      resolvedHeadingTrue,
      headingMagnetic,
      magneticVariation,
    ]
      .filter((reading) => reading.value !== null && reading.timestampMs !== null)
      .map((reading) => reading.timestampMs as number);

    this.cachedData = {
      position: position.value,
      speedOverGround: speedOverGround.value,
      courseOverGroundTrue: resolvedCourseTrue.value,
      headingTrue: resolvedHeadingTrue.value,
      headingMagnetic: headingMagnetic.value,
      magneticVariation: magneticVariation.value,
      // A snapshot is only as fresh as its oldest accepted component. This is
      // the source measurement time, not the wall clock time of this read.
      lastUpdateMs: acceptedTimestamps.length > 0 ? Math.min(...acceptedTimestamps) : null,
    };

    const navigationData = this.getCachedNavigationData();

    this.logger('debug', 'Vessel navigation data retrieved', {
      hasPosition: !!navigationData.position,
      hasSpeed: navigationData.speedOverGround !== undefined,
      hasCourse: navigationData.courseOverGroundTrue !== undefined,
      hasHeadingTrue: navigationData.headingTrue !== undefined,
      hasHeadingMagnetic: navigationData.headingMagnetic !== undefined,
      isComplete: navigationData.isComplete,
      dataAge: navigationData.dataAge ?? null,
    });

    return navigationData;
  }

  /**
   * Get vessel GPS position from SignalK navigation data
   * @returns Position coordinates or null if not available
   */
  public getVesselPosition(): GeoLocation | null {
    return this.readPosition().value;
  }

  private readPosition(): TimedReading<GeoLocation> {
    try {
      const positionData = this.app.getSelfPath(NAV.POSITION);

      if (!this.isValidSignalKData(positionData)) {
        this.logger('debug', 'No position data available from navigation.position');
        return EMPTY_READING;
      }

      if (this.isExcludedSource(positionData)) {
        this.logger('debug', 'Ignoring position data from excluded source', {
          source: positionData.$source,
        });
        return EMPTY_READING;
      }

      const timestampMs = this.getFreshTimestamp(positionData, 'position');
      if (timestampMs === null) return EMPTY_READING;

      const value = positionData.value as { latitude?: number; longitude?: number };

      if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
        this.logger('debug', 'Invalid position data structure', { value });
        return EMPTY_READING;
      }

      if (!isValidCoordinates(value.latitude, value.longitude)) {
        this.logger('warn', 'Invalid position coordinates', {
          latitude: value.latitude,
          longitude: value.longitude,
        });
        return EMPTY_READING;
      }

      const position: GeoLocation = {
        latitude: value.latitude,
        longitude: value.longitude,
      };

      this.logger('debug', 'Retrieved vessel position', {
        latitude: position.latitude,
        longitude: position.longitude,
        source: positionData.$source,
      });

      return { value: position, timestampMs };
    } catch (error) {
      this.logger('error', 'Error retrieving vessel position', {
        error: toErrorMessage(error),
      });
      return EMPTY_READING;
    }
  }

  /**
   * Get vessel speed over ground from SignalK navigation data
   * @returns Speed in m/s or null if not available
   */
  public getVesselSpeedOverGround(): number | null {
    return this.readNumericSelfPath(NAV.SPEED_OVER_GROUND, isValidVesselSpeed, 'speed over ground')
      .value;
  }

  /**
   * Read a numeric leaf from a `self` navigation path: validate the SignalK
   * data shape, reject excluded sources, and range-check via `isValid`. Returns
   * null when absent, from an excluded source, non-numeric, or out of range.
   * `isValid` also rejects non-finite values (a NaN slips past a bare
   * `typeof === 'number'` since `NaN < MIN` and `NaN > MAX` are both false).
   * Shared by the speed, course-fallback, heading, and magnetic-variation
   * getters.
   * @private
   */
  private readNumericSelfPath(
    path: string,
    isValid: (value: number) => boolean,
    label: string
  ): TimedReading<number> {
    try {
      const data = this.app.getSelfPath(path);
      if (!this.isValidSignalKData(data) || typeof data.value !== 'number') {
        return EMPTY_READING;
      }
      if (this.isExcludedSource(data)) {
        this.logger('debug', `Ignoring ${label} from excluded source`, { source: data.$source });
        return EMPTY_READING;
      }
      const timestampMs = this.getFreshTimestamp(data, label);
      if (timestampMs === null) return EMPTY_READING;
      const value = data.value;
      if (!isValid(value)) {
        this.logger('warn', `Invalid ${label} value`, { value });
        return EMPTY_READING;
      }
      this.logger('debug', `Retrieved ${label}`, { value, source: data.$source });
      return { value, timestampMs };
    } catch (error) {
      this.logger('error', `Error retrieving ${label}`, { error: toErrorMessage(error) });
      return EMPTY_READING;
    }
  }

  /** Returns the best available true course or heading in radians. */
  public getVesselCourseOverGroundTrue(): number | null {
    const courseTrue = this.readNumericSelfPath(
      NAV.COURSE_OVER_GROUND_TRUE,
      isValidBearing,
      'course over ground (true)'
    );
    if (courseTrue.value !== null) return courseTrue.value;

    const variation = this.readNumericSelfPath(
      NAV.MAGNETIC_VARIATION,
      (value) => Math.abs(value) <= Math.PI,
      'magnetic variation'
    );
    const courseMagnetic = this.correctMagneticReading(
      this.readNumericSelfPath(
        NAV.COURSE_OVER_GROUND_MAGNETIC,
        isValidBearing,
        'course over ground (magnetic)'
      ),
      variation,
      'course over ground'
    );
    if (courseMagnetic.value !== null) return courseMagnetic.value;

    const headingTrue = this.readNumericSelfPath(
      NAV.HEADING_TRUE,
      isValidBearing,
      'heading (true)'
    );
    if (headingTrue.value !== null) return headingTrue.value;

    const headingMagnetic = this.correctMagneticReading(
      this.readNumericSelfPath(NAV.HEADING_MAGNETIC, isValidBearing, 'heading (magnetic)'),
      variation,
      'heading'
    );
    if (headingMagnetic.value !== null) return headingMagnetic.value;

    this.logger('debug', 'No course or heading data available from any source');
    return null;
  }

  /**
   * Get vessel true heading from SignalK navigation data
   * @returns Heading in radians or null if not available
   */
  public getVesselHeadingTrue(): number | null {
    return this.getHeading(NAV.HEADING_TRUE);
  }

  /**
   * Get vessel magnetic heading from SignalK navigation data
   * @returns Heading in radians or null if not available
   */
  public getVesselHeadingMagnetic(): number | null {
    return this.getHeading(NAV.HEADING_MAGNETIC);
  }

  /**
   * Shared heading getter for true/magnetic. Validates source, type, and 0-2π range.
   * @private
   */
  private getHeading(path: typeof NAV.HEADING_TRUE | typeof NAV.HEADING_MAGNETIC): number | null {
    const label = path === NAV.HEADING_TRUE ? 'heading (true)' : 'heading (magnetic)';
    return this.readNumericSelfPath(path, isValidBearing, label).value;
  }

  /**
   * Get magnetic variation from SignalK navigation data
   * @returns Magnetic variation in radians (positive = East) or null if not available
   */
  public getMagneticVariation(): number | null {
    // Magnetic variation is a signed offset in radians: plausible range is -π to π.
    return this.readNumericSelfPath(
      NAV.MAGNETIC_VARIATION,
      (variation) => Math.abs(variation) <= Math.PI,
      'magnetic variation'
    ).value;
  }

  /**
   * Get cached vessel data without making new SignalK calls
   * @returns Cached vessel navigation data
   */
  public getCachedNavigationData(): VesselNavigationData {
    const dataAge = this.getDataAge();

    return {
      position: this.cachedData.position
        ? {
            latitude: this.cachedData.position.latitude,
            longitude: this.cachedData.position.longitude,
          }
        : undefined,
      speedOverGround: this.cachedData.speedOverGround ?? undefined,
      courseOverGroundTrue: this.cachedData.courseOverGroundTrue ?? undefined,
      headingTrue: this.cachedData.headingTrue ?? undefined,
      headingMagnetic: this.cachedData.headingMagnetic ?? undefined,
      magneticVariation: this.cachedData.magneticVariation ?? undefined,
      isComplete: this.hasCompleteData(),
      // `?? undefined` (not `|| undefined`) so a freshly written age of 0 survives.
      dataAge: dataAge ?? undefined,
    };
  }

  /**
   * True when the cache holds the position, speed, and course trio the
   * apparent-wind math needs. Shared by `getCachedNavigationData` and
   * `getHealthStatus` so the latter does not build a full navigation snapshot
   * (with its second `Date.now()` read) just to extract this flag.
   * @private
   */
  private hasCompleteData(): boolean {
    return !!(
      this.cachedData.position &&
      typeof this.cachedData.speedOverGround === 'number' &&
      typeof this.cachedData.courseOverGroundTrue === 'number'
    );
  }

  /**
   * Get age of cached data in seconds
   * @returns Age in seconds or null if no cached data
   */
  public getDataAge(): number | null {
    const elapsedMs = elapsedSinceMs(this.cachedData.lastUpdateMs);
    return elapsedMs === null ? null : Math.floor(elapsedMs / 1000);
  }

  /**
   * Check if cached data is stale
   * @returns True if data is older than maxDataAge
   */
  public isDataStale(): boolean {
    return this.isAgeStale(this.getDataAge());
  }

  /**
   * Staleness test against an already-read age, so a caller holding one age
   * snapshot can derive staleness without a second `Date.now()` read.
   * @private
   */
  private isAgeStale(age: number | null): boolean {
    return age !== null && age > this.maxDataAge;
  }

  /**
   * Clear cached data (useful for testing or configuration changes)
   */
  public clearCache(): void {
    this.cachedData = EMPTY_CACHED_VESSEL_DATA;
    this.logger('debug', 'SignalK data cache cleared');
  }

  private correctMagneticReading(
    magnetic: TimedReading<number>,
    variation: TimedReading<number>,
    label: string
  ): TimedReading<number> {
    if (
      magnetic.value === null ||
      magnetic.timestampMs === null ||
      variation.value === null ||
      variation.timestampMs === null
    ) {
      if (magnetic.value !== null) {
        this.logger('debug', `Cannot convert magnetic ${label} to true without fresh variation`);
      }
      return EMPTY_READING;
    }

    return {
      value: normalizeAngle0To2Pi(magnetic.value + variation.value),
      timestampMs: Math.min(magnetic.timestampMs, variation.timestampMs),
    };
  }

  /**
   * Return the source measurement timestamp when it is valid and fresh.
   * Navigation leaves without trustworthy timestamps are not safe inputs for
   * position selection or vector calculations.
   */
  private getFreshTimestamp(data: SignalKDataValue, label: string): number | null {
    if (typeof data.timestamp !== 'string') {
      this.logger('warn', `Ignoring ${label} without a Signal K timestamp`);
      return null;
    }

    const timestampMs = Date.parse(data.timestamp);
    if (!Number.isFinite(timestampMs)) {
      this.logger('warn', `Ignoring ${label} with an invalid Signal K timestamp`, {
        timestamp: data.timestamp,
      });
      return null;
    }

    const ageSeconds = Math.floor((Date.now() - timestampMs) / 1000);
    if (ageSeconds > this.maxDataAge || ageSeconds < -this.maxDataAge) {
      this.logger('warn', `Ignoring ${label} with a stale or future Signal K timestamp`, {
        timestamp: data.timestamp,
        ageSeconds,
        maxDataAgeSeconds: this.maxDataAge,
      });
      return null;
    }

    return timestampMs;
  }

  /**
   * Validate SignalK data structure
   * @private
   */
  private isValidSignalKData(data: unknown): data is SignalKDataValue {
    return !!(
      data &&
      typeof data === 'object' &&
      'value' in data &&
      (data as { value: unknown }).value !== null &&
      (data as { value: unknown }).value !== undefined
    );
  }

  /**
   * Check if a data source should be excluded to avoid feedback loops. Matches
   * by lowercased substring, so the single entry `node-red` also covers labels
   * like `signalk-node-red`.
   * @private
   */
  private isExcludedSource(data: SignalKDataValue): boolean {
    if (!data.$source) return false;
    const source = data.$source.toLowerCase();
    for (const excluded of EXCLUDED_SOURCE_LABELS) {
      if (source.includes(excluded)) return true;
    }
    return false;
  }

  /**
   * Get service health status
   */
  public getHealthStatus(): {
    status: PluginState;
    dataAge: number | null;
    isStale: boolean;
    hasComplete: boolean;
  } {
    const dataAge = this.getDataAge();
    const isStale = this.isAgeStale(dataAge);

    return {
      status: isStale ? 'error' : 'running',
      dataAge,
      isStale,
      hasComplete: this.hasCompleteData(),
    };
  }
}
