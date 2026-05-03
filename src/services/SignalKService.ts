/**
 * SignalK Data Service
 * Modern TypeScript implementation for vessel navigation data retrieval
 * Provides type-safe interface to SignalK server with comprehensive fallback logic
 */

import type { ServerAPI } from '@signalk/server-api';
import { VALIDATION_LIMITS } from '../constants/index.js';
import type { GeoLocation, Logger, PluginState, VesselNavigationData } from '../types/index.js';
import { isValidCoordinates, msToKnots, radiansToDegrees } from '../utils/conversions.js';

/** Source labels (lowercased) whose data we deliberately ignore to avoid feedback loops. */
const EXCLUDED_SOURCE_LABELS: ReadonlyArray<string> = ['signalk-node-red', 'node-red'];

/**
 * SignalK data value structure
 * Used to type the response from getSelfPath
 */
interface SignalKDataValue {
  value: unknown;
  timestamp?: string;
  source?: {
    label?: string;
    type?: string;
    bus?: string;
    src?: string;
  };
}

/**
 * Cached vessel data structure
 */
interface CachedVesselData {
  position: GeoLocation | null;
  speedOverGround: number | null;
  courseOverGroundTrue: number | null;
  headingTrue: number | null;
  headingMagnetic: number | null;
  lastUpdate: Date | null;
}

/**
 * SignalK Service for vessel navigation data operations
 * Provides comprehensive vessel data retrieval with fallback logic and caching
 */
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
    lastUpdate: null,
  };

  constructor(app: ServerAPI, logger: Logger = () => {}) {
    this.app = app;
    this.logger = logger;

    this.logger('info', 'SignalKService initialized', {
      maxDataAge: this.maxDataAge,
    });
  }

  /**
   * Get comprehensive vessel navigation data
   * @returns Complete vessel navigation data with validity indicators
   */
  public getVesselNavigationData(): VesselNavigationData {
    const position = this.getVesselPosition();
    const speedOverGround = this.getVesselSpeedOverGround();
    const courseOverGroundTrue = this.getVesselCourseOverGroundTrue();
    const headingTrue = this.getVesselHeadingTrue();
    const headingMagnetic = this.getVesselHeadingMagnetic();
    const magneticVariation = this.getMagneticVariation();
    const dataAge = this.getDataAge();

    // Update cache
    this.cachedData = {
      position,
      speedOverGround,
      courseOverGroundTrue,
      headingTrue,
      headingMagnetic,
      lastUpdate: new Date(),
    };

    // Determine if we have complete data for wind calculations
    const isComplete = !!(
      position &&
      typeof speedOverGround === 'number' &&
      typeof courseOverGroundTrue === 'number'
    );

    const navigationData: VesselNavigationData = {
      position: position
        ? { latitude: position.latitude, longitude: position.longitude }
        : undefined,
      speedOverGround: speedOverGround ?? undefined,
      courseOverGroundTrue: courseOverGroundTrue ?? undefined,
      headingMagnetic: headingMagnetic ?? undefined,
      headingTrue: headingTrue ?? undefined,
      magneticVariation: magneticVariation ?? undefined,
      isComplete,
      dataAge: dataAge || undefined,
    };

    this.logger('debug', 'Vessel navigation data retrieved', {
      hasPosition: !!position,
      hasSpeed: typeof speedOverGround === 'number',
      hasCourse: typeof courseOverGroundTrue === 'number',
      hasHeadingTrue: typeof headingTrue === 'number',
      hasHeadingMagnetic: typeof headingMagnetic === 'number',
      isComplete,
      dataAge,
    });

    return navigationData;
  }

  /**
   * Get vessel GPS position from SignalK navigation data
   * @returns Position coordinates or null if not available
   */
  public getVesselPosition(): GeoLocation | null {
    try {
      const positionData = this.app.getSelfPath('navigation.position');

      if (!this.isValidSignalKData(positionData)) {
        this.logger('debug', 'No position data available from navigation.position');
        return null;
      }

      // Filter out data from excluded sources
      if (this.isExcludedSource(positionData)) {
        this.logger('debug', 'Ignoring position data from excluded source', {
          source: positionData.source,
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
        isValid: true,
      };

      this.logger('debug', 'Retrieved vessel position', {
        latitude: position.latitude,
        longitude: position.longitude,
        source: positionData.source?.label,
      });

      return position;
    } catch (error) {
      this.logger('error', 'Error retrieving vessel position', {
        error: error instanceof Error ? error.message : String(error),
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
      const speedData = this.app.getSelfPath('navigation.speedOverGround');

      if (!this.isValidSignalKData(speedData) || typeof speedData.value !== 'number') {
        this.logger('debug', 'No speed over ground data available');
        return null;
      }

      // Filter out data from excluded sources
      if (this.isExcludedSource(speedData)) {
        this.logger('debug', 'Ignoring speed data from excluded source', {
          source: speedData.source,
        });
        return null;
      }

      const speed = speedData.value;

      // Validate speed (should be non-negative and within reasonable limits)
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
        source: speedData.source?.label,
      });

      return speed;
    } catch (error) {
      this.logger('error', 'Error retrieving vessel speed over ground', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get vessel course over ground (true) with intelligent fallbacks
   * @returns Course in radians or null if not available
   */
  public getVesselCourseOverGroundTrue(): number | null {
    // Define fallback order for course/heading sources
    const fallbackPaths = [
      'navigation.courseOverGroundTrue',
      'navigation.courseOverGroundMagnetic',
      'navigation.headingTrue',
      'navigation.headingMagnetic',
    ] as const;

    for (const path of fallbackPaths) {
      try {
        const courseData = this.app.getSelfPath(path);

        if (!this.isValidSignalKData(courseData) || typeof courseData.value !== 'number') {
          continue;
        }

        // Filter out data from excluded sources
        if (this.isExcludedSource(courseData)) {
          this.logger('debug', `Ignoring ${path} data from excluded source`, {
            source: courseData.source,
          });
          continue;
        }

        const course = courseData.value;

        // Validate course/heading (should be 0-2π radians)
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
          source: courseData.source?.label,
        });

        return course;
      } catch (error) {
        this.logger('error', `Error retrieving ${path}`, {
          error: error instanceof Error ? error.message : String(error),
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
    return this.getHeading('navigation.headingTrue');
  }

  /**
   * Get vessel magnetic heading from SignalK navigation data
   * @returns Heading in radians or null if not available
   */
  public getVesselHeadingMagnetic(): number | null {
    return this.getHeading('navigation.headingMagnetic');
  }

  /**
   * Shared heading getter for true/magnetic. Validates source, type, and 0-2π range.
   * @private
   */
  private getHeading(path: 'navigation.headingTrue' | 'navigation.headingMagnetic'): number | null {
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
        error: error instanceof Error ? error.message : String(error),
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
      const variationData = this.app.getSelfPath('navigation.magneticVariation');

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
        error: error instanceof Error ? error.message : String(error),
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
      isComplete: !!(
        this.cachedData.position &&
        typeof this.cachedData.speedOverGround === 'number' &&
        typeof this.cachedData.courseOverGroundTrue === 'number'
      ),
      dataAge: dataAge || undefined,
    };
  }

  /**
   * Check if vessel is considered to be moving
   * @param threshold Speed threshold in m/s (default from VALIDATION_LIMITS.VESSEL_MOVING_THRESHOLD)
   * @returns True if vessel speed exceeds threshold
   */
  public isVesselMoving(threshold = VALIDATION_LIMITS.VESSEL_MOVING_THRESHOLD): boolean {
    const speed = this.getVesselSpeedOverGround();
    return speed !== null && speed > threshold;
  }

  /**
   * Get age of cached data in seconds
   * @returns Age in seconds or null if no cached data
   */
  public getDataAge(): number | null {
    if (!this.cachedData.lastUpdate) {
      return null;
    }

    return Math.floor((Date.now() - this.cachedData.lastUpdate.getTime()) / 1000);
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
      lastUpdate: null,
    };
    this.logger('debug', 'SignalK data cache cleared');
  }

  /**
   * Validate SignalK data structure
   * @private
   */
  private isValidSignalKData(data: SignalKDataValue | null | undefined): data is SignalKDataValue {
    return !!(
      data &&
      typeof data === 'object' &&
      'value' in data &&
      data.value !== null &&
      data.value !== undefined
    );
  }

  /**
   * Check if data source should be excluded (e.g., node-red sources to avoid feedback loops).
   * 'signalk-node-red' is a substring of 'node-red' is true, so a single check
   * against 'node-red' covers both — the explicit list keeps intent obvious.
   * @private
   */
  private isExcludedSource(data: SignalKDataValue): boolean {
    if (!data.source?.label) return false;
    const source = data.source.label.toLowerCase();
    for (const excluded of EXCLUDED_SOURCE_LABELS) {
      if (source.includes(excluded)) return true;
    }
    return false;
  }

  /**
   * Validate course/heading value in radians (0 to 2π)
   * @private
   */
  private isValidCourse(course: number): boolean {
    return (
      typeof course === 'number' &&
      !Number.isNaN(course) &&
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
