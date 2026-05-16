/**
 * SignalK navigation-data accessor with caching and source-exclusion logic.
 * Wraps `getSelfPath` calls so the rest of the plugin sees normalized values.
 */

import type { ServerAPI } from '@signalk/server-api';
import { SIGNALK_PATHS, VALIDATION_LIMITS } from '../constants/index.js';
import type { GeoLocation, Logger, PluginState, VesselNavigationData } from '../types/index.js';
import {
  isValidCoordinates,
  msToKnots,
  radiansToDegrees,
  toErrorMessage,
} from '../utils/conversions.js';

const NAV = SIGNALK_PATHS.NAVIGATION;

/**
 * Source labels (lowercased) whose data we deliberately ignore to avoid
 * feedback loops. Substring match, so `'node-red'` covers `'signalk-node-red'`.
 */
const EXCLUDED_SOURCE_LABELS: ReadonlyArray<string> = ['node-red'];

/**
 * Course/heading fallback chain in priority order: COG-true, COG-magnetic,
 * heading-true, heading-magnetic. Hoisted to module level so the array is
 * not re-allocated on every call to `getVesselCourseOverGroundTrue`.
 */
const COURSE_FALLBACK_PATHS = [
  NAV.COURSE_OVER_GROUND_TRUE,
  NAV.COURSE_OVER_GROUND_MAGNETIC,
  NAV.HEADING_TRUE,
  NAV.HEADING_MAGNETIC,
] as const;

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

interface CachedVesselData {
  position: GeoLocation | null;
  speedOverGround: number | null;
  courseOverGroundTrue: number | null;
  headingTrue: number | null;
  headingMagnetic: number | null;
  magneticVariation: number | null;
  /** Wall-clock millisecond timestamp of the most recent cache write (null when never written). */
  lastUpdateMs: number | null;
}

export class SignalKService {
  private readonly app: ServerAPI;
  private readonly logger: Logger;
  private readonly maxDataAge = VALIDATION_LIMITS.MAX_DATA_AGE;

  private cachedData: CachedVesselData = {
    position: null,
    speedOverGround: null,
    courseOverGroundTrue: null,
    headingTrue: null,
    headingMagnetic: null,
    magneticVariation: null,
    lastUpdateMs: null,
  };

  constructor(app: ServerAPI, logger: Logger = () => {}) {
    this.app = app;
    this.logger = logger;

    this.logger('info', 'SignalKService initialized', {
      maxDataAge: this.maxDataAge,
    });
  }

  public getVesselNavigationData(): VesselNavigationData {
    this.cachedData = {
      position: this.getVesselPosition(),
      speedOverGround: this.getVesselSpeedOverGround(),
      courseOverGroundTrue: this.getVesselCourseOverGroundTrue(),
      headingTrue: this.getVesselHeadingTrue(),
      headingMagnetic: this.getVesselHeadingMagnetic(),
      magneticVariation: this.getMagneticVariation(),
      lastUpdateMs: Date.now(),
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
    try {
      const positionData = this.app.getSelfPath(NAV.POSITION);

      if (!this.isValidSignalKData(positionData)) {
        this.logger('debug', 'No position data available from navigation.position');
        return null;
      }

      if (this.isExcludedSource(positionData)) {
        this.logger('debug', 'Ignoring position data from excluded source', {
          source: positionData.$source,
        });
        return null;
      }

      const value = positionData.value as { latitude?: number; longitude?: number };

      if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
        this.logger('debug', 'Invalid position data structure', { value });
        return null;
      }

      if (!isValidCoordinates(value.latitude, value.longitude)) {
        this.logger('warn', 'Invalid position coordinates', {
          latitude: value.latitude,
          longitude: value.longitude,
        });
        return null;
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

      return position;
    } catch (error) {
      this.logger('error', 'Error retrieving vessel position', {
        error: toErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Get vessel speed over ground from SignalK navigation data
   * @returns Speed in m/s or null if not available
   */
  public getVesselSpeedOverGround(): number | null {
    try {
      const speedData = this.app.getSelfPath(NAV.SPEED_OVER_GROUND);

      if (!this.isValidSignalKData(speedData) || typeof speedData.value !== 'number') {
        this.logger('debug', 'No speed over ground data available');
        return null;
      }

      if (this.isExcludedSource(speedData)) {
        this.logger('debug', 'Ignoring speed data from excluded source', {
          source: speedData.$source,
        });
        return null;
      }

      const speed = speedData.value;

      if (
        speed < VALIDATION_LIMITS.VESSEL_SPEED.MIN ||
        speed > VALIDATION_LIMITS.VESSEL_SPEED.MAX
      ) {
        this.logger('warn', 'Invalid speed value', { speed });
        return null;
      }

      this.logger('debug', 'Retrieved vessel speed over ground', {
        speed,
        speedKnots: msToKnots(speed).toFixed(1),
        source: speedData.$source,
      });

      return speed;
    } catch (error) {
      this.logger('error', 'Error retrieving vessel speed over ground', {
        error: toErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Returns the best-available course/heading in radians, falling back through
   * COG-true, COG-magnetic, heading-true, heading-magnetic in order.
   *
   * Caveat: when the chosen source is magnetic (COG-magnetic or heading-magnetic),
   * the returned value is a magnetic reference even though the method is named
   * `...True`. The plugin's apparent-wind math treats it as a true reference,
   * which biases the result by the local magnetic variation (a few degrees in
   * most cruising waters, up to ~10 degrees in high latitudes). We accept this
   * trade-off to keep apparent-wind output flowing when only magnetic sources
   * are available; `magneticVariation` is included in VesselNavigationData for
   * callers that want to apply a correction.
   */
  public getVesselCourseOverGroundTrue(): number | null {
    for (const path of COURSE_FALLBACK_PATHS) {
      try {
        const courseData = this.app.getSelfPath(path);

        if (!this.isValidSignalKData(courseData) || typeof courseData.value !== 'number') {
          continue;
        }

        if (this.isExcludedSource(courseData)) {
          this.logger('debug', `Ignoring ${path} data from excluded source`, {
            source: courseData.$source,
          });
          continue;
        }

        const course = courseData.value;

        if (!this.isValidCourse(course)) {
          this.logger('warn', `Invalid ${path} value`, {
            course,
            courseDegrees: radiansToDegrees(course),
          });
          continue;
        }

        this.logger('debug', `Retrieved vessel course from ${path}`, {
          course,
          courseDegrees: radiansToDegrees(course).toFixed(1),
          source: courseData.$source,
        });

        return course;
      } catch (error) {
        this.logger('error', `Error retrieving ${path}`, {
          error: toErrorMessage(error),
        });
      }
    }

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
    try {
      const headingData = this.app.getSelfPath(path);
      if (!this.isValidSignalKData(headingData) || typeof headingData.value !== 'number') {
        return null;
      }
      if (this.isExcludedSource(headingData)) {
        return null;
      }
      const heading = headingData.value;
      return this.isValidCourse(heading) ? heading : null;
    } catch (error) {
      this.logger('error', `Error retrieving ${path}`, {
        error: toErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Get magnetic variation from SignalK navigation data
   * @returns Magnetic variation in radians (positive = East) or null if not available
   */
  public getMagneticVariation(): number | null {
    try {
      const variationData = this.app.getSelfPath(NAV.MAGNETIC_VARIATION);

      if (!this.isValidSignalKData(variationData) || typeof variationData.value !== 'number') {
        return null;
      }

      if (this.isExcludedSource(variationData)) {
        return null;
      }

      const variation = variationData.value;

      // Validate variation (should be reasonable: -π to π)
      if (!Number.isFinite(variation) || Math.abs(variation) > Math.PI) {
        return null;
      }

      return variation;
    } catch (error) {
      this.logger('error', 'Error retrieving magnetic variation', {
        error: toErrorMessage(error),
      });
      return null;
    }
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
      isComplete: !!(
        this.cachedData.position &&
        typeof this.cachedData.speedOverGround === 'number' &&
        typeof this.cachedData.courseOverGroundTrue === 'number'
      ),
      // See getVesselNavigationData() for the explicit null-check rationale.
      dataAge: dataAge !== null ? dataAge : undefined,
    };
  }

  /**
   * Check if vessel is considered to be moving
   * @param threshold Speed threshold in m/s (default from VALIDATION_LIMITS.VESSEL_MOVING_THRESHOLD)
   * @returns True if vessel speed exceeds threshold
   */
  public isVesselMoving(threshold = VALIDATION_LIMITS.VESSEL_MOVING_THRESHOLD): boolean {
    const speed = this.cachedData.speedOverGround ?? this.getVesselSpeedOverGround();
    return speed !== null && speed > threshold;
  }

  /**
   * Get age of cached data in seconds
   * @returns Age in seconds or null if no cached data
   */
  public getDataAge(): number | null {
    const lastUpdateMs = this.cachedData.lastUpdateMs;
    if (lastUpdateMs === null) {
      return null;
    }
    return Math.floor((Date.now() - lastUpdateMs) / 1000);
  }

  /**
   * Check if cached data is stale
   * @returns True if data is older than maxDataAge
   */
  public isDataStale(): boolean {
    const age = this.getDataAge();
    return age !== null && age > this.maxDataAge;
  }

  /**
   * Clear cached data (useful for testing or configuration changes)
   */
  public clearCache(): void {
    this.cachedData = {
      position: null,
      speedOverGround: null,
      courseOverGroundTrue: null,
      headingTrue: null,
      headingMagnetic: null,
      magneticVariation: null,
      lastUpdateMs: null,
    };
    this.logger('debug', 'SignalK data cache cleared');
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

  private isValidCourse(course: number): boolean {
    return (
      Number.isFinite(course) &&
      course >= VALIDATION_LIMITS.WIND_DIRECTION.MIN &&
      course <= VALIDATION_LIMITS.WIND_DIRECTION.MAX
    );
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
    const isStale = this.isDataStale();
    const cachedData = this.getCachedNavigationData();

    return {
      status: isStale ? 'error' : 'running',
      dataAge,
      isStale,
      hasComplete: cachedData.isComplete,
    };
  }
}
