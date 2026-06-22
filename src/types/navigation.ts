/**
 * Vessel navigation and geolocation types for signalk-virtual-weather-sensors.
 */

/**
 * Vessel navigation data required for wind calculations
 * Contains motion vectors and position information
 */
export interface VesselNavigationData {
  /** GPS position coordinates */
  readonly position?:
    | {
        readonly latitude: number;
        readonly longitude: number;
      }
    | undefined;

  /** Speed over ground in m/s */
  readonly speedOverGround?: number | undefined;

  /** Course over ground (true) in radians */
  readonly courseOverGroundTrue?: number | undefined;

  /** Heading (magnetic) in radians */
  readonly headingMagnetic?: number | undefined;

  /** Heading (true) in radians */
  readonly headingTrue?: number | undefined;

  /** Magnetic variation in radians (positive = East) */
  readonly magneticVariation?: number | undefined;

  /** Indicates if all required fields are present for calculations */
  readonly isComplete: boolean;

  /** Age of navigation data in seconds */
  readonly dataAge?: number | undefined;
}

/** Geolocation coordinates. */
export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Returns true when navigation data carries the speed and course required for
 * apparent-wind calculations and is flagged complete by the producer.
 */
export function isCompleteNavigationData(
  data: VesselNavigationData
): data is VesselNavigationData & {
  readonly speedOverGround: number;
  readonly courseOverGroundTrue: number;
} {
  return !!(
    data.isComplete &&
    Number.isFinite(data.speedOverGround) &&
    Number.isFinite(data.courseOverGroundTrue)
  );
}
