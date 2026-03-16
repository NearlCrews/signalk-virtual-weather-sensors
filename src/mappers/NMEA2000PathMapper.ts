/**
 * NMEA2000 Path Mapper for Enhanced Weather Data
 * Modern TypeScript implementation aligned with sk-n2k-emitter conventions
 * Maps comprehensive weather data to standardized NMEA2000 Signal K paths with proper PGN support
 */

import { PGN, SIGNALK_PATHS, SIGNALK_SOURCE } from "../constants/index.js";
import type { Logger, WeatherData } from "../types/index.js";
import { NMEA2000Validator } from "../utils/validation.js";

/**
 * NMEA2000 temperature instance assignments (aligned with sk-n2k-emitter)
 */
const TEMPERATURE_INSTANCES = {
	OUTSIDE: 101,
	DEW_POINT: 102,
	WIND_CHILL: 103,
	HEAT_INDEX: 104,
	REAL_FEEL_SHADE: 108,
	APPARENT: 109,
	WET_BULB: 110,
	WET_BULB_GLOBE: 111,
} as const;

/**
 * NMEA2000 humidity instance assignments (aligned with sk-n2k-emitter)
 */
const HUMIDITY_INSTANCES = {
	OUTSIDE: 100,
	INSIDE: 101,
} as const;

/**
 * Signal K value structure with metadata
 */
interface SignalKValue {
	readonly path: string;
	readonly value: unknown;
	readonly timestamp: string;
	readonly meta?: {
		readonly units?: string;
		readonly displayName?: string;
		readonly description?: string;
	};
}

/**
 * NMEA2000 Path Mapper Service
 * Provides comprehensive mapping of weather data to NMEA2000-compatible Signal K paths
 */
export class NMEA2000PathMapper {
	private readonly logger: Logger;

	constructor(logger: Logger = () => {}) {
		this.logger = logger;
		this.logger(
			"info",
			"NMEA2000PathMapper initialized with enhanced sk-n2k-emitter alignment",
		);
	}

	/**
	 * Map comprehensive weather data to NMEA2000 Signal K paths
	 * @param weatherData Enhanced weather data from AccuWeather
	 * @returns Signal K delta message with complete NMEA2000 mappings
	 */
	public mapToSignalKPaths(weatherData: WeatherData): {
		context: string;
		updates: Array<{
			source: { label: string; type: string };
			timestamp: string;
			values: Array<{ path: string; value: unknown }>;
		}>;
	} {
		// Validate and sanitize data for NMEA2000 compatibility
		const sanitizedData = NMEA2000Validator.sanitizeForNMEA2000(weatherData);

		const timestamp = sanitizedData.timestamp || new Date().toISOString();
		const values: SignalKValue[] = [];

		// Core environmental measurements
		this.addCoreEnvironmentalPaths(values, sanitizedData, timestamp);

		// Enhanced temperature readings (multiple PGN 130312 instances)
		this.addEnhancedTemperaturePaths(values, sanitizedData, timestamp);

		// Humidity measurements (PGN 130313 instances)
		this.addHumidityPaths(values, sanitizedData, timestamp);

		// Comprehensive wind data (PGN 130306 enhanced)
		this.addWindPaths(values, sanitizedData, timestamp);

		// Atmospheric conditions and visibility
		this.addAtmosphericPaths(values, sanitizedData, timestamp);

		// Calculated atmospheric properties
		this.addCalculatedPaths(values, sanitizedData, timestamp);

		// Precipitation and weather trends
		this.addPrecipitationPaths(values, sanitizedData, timestamp);

		// Marine safety and comfort indices
		this.addSafetyPaths(values, sanitizedData, timestamp);

		this.logger("debug", "Enhanced NMEA2000 path mapping completed", {
			totalPaths: values.length,
			temperaturePaths: this.countPathsByCategory(values, "temperature"),
			windPaths: this.countPathsByCategory(values, "wind"),
			atmosphericPaths: this.countPathsByCategory(values, "environment"),
			enhancedFields: this.countEnhancedFields(values),
		});

		return {
			context: "vessels.self",
			updates: [
				{
					source: {
						label: SIGNALK_SOURCE.label,
						type: SIGNALK_SOURCE.type,
					},
					timestamp,
					values: values.map((v) => ({ path: v.path, value: v.value })),
				},
			],
		};
	}

	/**
	 * Add core environmental measurement paths (PGN 130311, 130312 base)
	 * @private
	 */
	private addCoreEnvironmentalPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// Core temperature (PGN 130312, instance 101)
		values.push({
			path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE,
			value: data.temperature,
			timestamp,
			meta: {
				units: "K",
				displayName: "Outside Temperature",
				description: "Current outside air temperature from AccuWeather API",
			},
		});

		// Atmospheric pressure (PGN 130311)
		values.push({
			path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE,
			value: data.pressure,
			timestamp,
			meta: {
				units: "Pa",
				displayName: "Atmospheric Pressure",
				description: "Current atmospheric pressure from AccuWeather API",
			},
		});

		// Relative humidity (PGN 130313, instance 100)
		// NOTE: Humidity format - Percentage vs Ratio
		// Signal K spec recommends ratio (0-1), but we use percentage (0-100) for Garmin compatibility.
		// Trade-off: Garmin marine displays and most NMEA2000 devices expect percentage format.
		// Impact: May cause minor display issues in some Signal K clients, but ensures proper
		// display on physical marine electronics where it matters most.
		// See TODO.md for full rationale and future considerations.
		values.push({
			path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.RELATIVE_HUMIDITY,
			value: data.humidity, // Already in percentage (0-100) format
			timestamp,
			meta: {
				units: "%",
				displayName: "Outside Relative Humidity",
				description: "Current outside relative humidity from AccuWeather API",
			},
		});
	}

	/**
	 * Add enhanced temperature readings (multiple PGN 130312 instances)
	 * @private
	 */
	private addEnhancedTemperaturePaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// Dew point temperature (PGN 130312, instance 102)
		values.push({
			path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT_TEMPERATURE,
			value: data.dewPoint,
			timestamp,
			meta: {
				units: "K",
				displayName: "Dew Point Temperature",
				description: "Dew point temperature from AccuWeather API",
			},
		});

		// Wind chill temperature (PGN 130312, instance 103)
		values.push({
			path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_WIND_CHILL_TEMPERATURE,
			value: data.windChill,
			timestamp,
			meta: {
				units: "K",
				displayName: "Wind Chill Temperature",
				description: "How cold it feels when wind speed is factored in",
			},
		});

		// Heat index temperature (PGN 130312, instance 104)
		values.push({
			path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_INDEX_TEMPERATURE,
			value: data.heatIndex,
			timestamp,
			meta: {
				units: "K",
				displayName: "Heat Index Temperature",
				description: "How hot it feels when humidity is factored in (RealFeel)",
			},
		});

		// Enhanced temperature readings (new from AccuWeather)
		if (data.realFeelShade !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.REAL_FEEL_SHADE,
				value: data.realFeelShade,
				timestamp,
				meta: {
					units: "K",
					displayName: "RealFeel Shade Temperature",
					description: "AccuWeather RealFeel temperature in shade conditions",
				},
			});
		}

		if (data.wetBulbTemperature !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_TEMPERATURE,
				value: data.wetBulbTemperature,
				timestamp,
				meta: {
					units: "K",
					displayName: "Wet Bulb Temperature",
					description: "Wet bulb temperature for heat stress assessment",
				},
			});
		}

		if (data.wetBulbGlobeTemperature !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_GLOBE_TEMPERATURE,
				value: data.wetBulbGlobeTemperature,
				timestamp,
				meta: {
					units: "K",
					displayName: "Wet Bulb Globe Temperature",
					description: "Military/marine standard for heat stress assessment",
				},
			});
		}

		if (data.apparentTemperature !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_TEMPERATURE,
				value: data.apparentTemperature,
				timestamp,
				meta: {
					units: "K",
					displayName: "Apparent Temperature",
					description:
						"AccuWeather apparent temperature (different from RealFeel)",
				},
			});
		}
	}

	/**
	 * Add humidity measurements (PGN 130313 instances)
	 * @private
	 */
	private addHumidityPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// Calculated absolute humidity
		if (data.absoluteHumidity !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.ABSOLUTE_HUMIDITY,
				value: data.absoluteHumidity,
				timestamp,
				meta: {
					units: "kg/m3",
					displayName: "Absolute Humidity",
					description:
						"Calculated absolute humidity from temperature and relative humidity",
				},
			});
		}
	}

	/**
	 * Add comprehensive wind data (enhanced PGN 130306)
	 * @private
	 */
	private addWindPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// True wind speed and direction (PGN 130306 base)
		values.push(
			{
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_TRUE,
				value: data.windSpeed,
				timestamp,
				meta: {
					units: "m/s",
					displayName: "True Wind Speed",
					description: "True wind speed from AccuWeather API",
				},
			},
			{
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_TRUE,
				value: data.windDirection,
				timestamp,
				meta: {
					units: "rad",
					displayName: "True Wind Direction",
					description: "True wind direction from AccuWeather API",
				},
			},
		);

		// Enhanced wind measurements (NEW from AccuWeather)
		if (data.windGustSpeed !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_GUST,
				value: data.windGustSpeed,
				timestamp,
				meta: {
					units: "m/s",
					displayName: "Wind Gust Speed",
					description: "Peak wind gust speed from AccuWeather API",
				},
			});
		}

		if (data.windGustFactor !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.GUST_FACTOR,
				value: data.windGustFactor,
				timestamp,
				meta: {
					units: "ratio",
					displayName: "Wind Gust Factor",
					description: "Ratio of gust speed to sustained wind speed",
				},
			});
		}

		if (data.beaufortScale !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.BEAUFORT_SCALE,
				value: data.beaufortScale,
				timestamp,
				meta: {
					units: "scale",
					displayName: "Beaufort Wind Scale",
					description:
						"Beaufort scale (0-12) calculated from wind and gust data",
				},
			});
		}

		// Calculated apparent wind (if available)
		if (data.apparentWindSpeed !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_APPARENT,
				value: data.apparentWindSpeed,
				timestamp,
				meta: {
					units: "m/s",
					displayName: "Apparent Wind Speed",
					description:
						"Calculated apparent wind speed relative to vessel motion",
				},
			});
		}

		if (data.apparentWindAngle !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_APPARENT,
				value: data.apparentWindAngle,
				timestamp,
				meta: {
					units: "rad",
					displayName: "Apparent Wind Angle",
					description: "Calculated apparent wind angle relative to vessel bow",
				},
			});
		}
	}

	/**
	 * Add atmospheric conditions and visibility data
	 * @private
	 */
	private addAtmosphericPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// UV Index (NEW from AccuWeather)
		if (data.uvIndex !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.UV_INDEX,
				value: data.uvIndex,
				timestamp,
				meta: {
					units: "index",
					displayName: "UV Index",
					description: "UV radiation index for crew safety assessment",
				},
			});
		}

		// Visibility (NEW from AccuWeather)
		if (data.visibility !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.VISIBILITY,
				value: data.visibility,
				timestamp,
				meta: {
					units: "m",
					displayName: "Visibility",
					description: "Atmospheric visibility distance from AccuWeather API",
				},
			});
		}

		// Cloud cover (NEW from AccuWeather)
		if (data.cloudCover !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_COVER,
				value: data.cloudCover,
				timestamp,
				meta: {
					units: "ratio",
					displayName: "Cloud Cover",
					description: "Cloud coverage as ratio (0-1, 0=clear, 1=overcast)",
				},
			});
		}

		// Cloud ceiling (NEW from AccuWeather)
		if (data.cloudCeiling !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_CEILING,
				value: data.cloudCeiling,
				timestamp,
				meta: {
					units: "m",
					displayName: "Cloud Ceiling",
					description: "Height of cloud base above surface level",
				},
			});
		}

		// Pressure tendency (NEW from AccuWeather)
		if (data.pressureTendency !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE_TENDENCY,
				value: data.pressureTendency,
				timestamp,
				meta: {
					displayName: "Pressure Tendency",
					description: "Barometric pressure trend (Rising/Falling/Steady)",
				},
			});
		}
	}

	/**
	 * Add calculated atmospheric properties
	 * @private
	 */
	private addCalculatedPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// Enhanced air density (calculated)
		if (data.airDensityEnhanced !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY,
				value: data.airDensityEnhanced,
				timestamp,
				meta: {
					units: "kg/m3",
					displayName: "Air Density",
					description:
						"Enhanced air density calculation including humidity and pressure effects",
				},
			});
		}
	}

	/**
	 * Add precipitation data paths
	 * @private
	 */
	private addPrecipitationPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// Precipitation last hour (NEW from AccuWeather)
		if (data.precipitationLastHour !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_LAST_HOUR,
				value: data.precipitationLastHour,
				timestamp,
				meta: {
					units: "mm",
					displayName: "Precipitation (Last Hour)",
					description: "Precipitation amount in the last hour",
				},
			});
		}

		// Current precipitation rate (NEW from AccuWeather)
		if (data.precipitationCurrent !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_CURRENT,
				value: data.precipitationCurrent,
				timestamp,
				meta: {
					units: "mm/h",
					displayName: "Current Precipitation Rate",
					description: "Current precipitation rate from AccuWeather API",
				},
			});
		}
	}

	/**
	 * Add marine safety and comfort indices
	 * @private
	 */
	private addSafetyPaths(
		values: SignalKValue[],
		data: WeatherData,
		timestamp: string,
	): void {
		// Heat stress index (calculated from wet bulb globe temperature)
		if (data.heatStressIndex !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_STRESS_INDEX,
				value: data.heatStressIndex,
				timestamp,
				meta: {
					units: "index",
					displayName: "Heat Stress Index",
					description:
						"Heat stress assessment (0=none, 4=extreme) from wet bulb globe temperature",
				},
			});
		}

		// Temperature departure (trend analysis)
		if (data.temperatureDeparture24h !== undefined) {
			values.push({
				path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE_DEPARTURE_24H,
				value: data.temperatureDeparture24h,
				timestamp,
				meta: {
					units: "K",
					displayName: "24-Hour Temperature Departure",
					description: "Temperature change from 24 hours ago (positive=warmer)",
				},
			});
		}
	}

	/**
	 * Get NMEA2000 PGN list for this weather data
	 */
	public getSupportedPGNs(): ReadonlyArray<number> {
		return [
			PGN.ENVIRONMENTAL_PRESSURE, // 130311 - Atmospheric pressure
			PGN.ENVIRONMENTAL_TEMPERATURE, // 130312 - Multiple temperature instances
			130313, // Humidity data (outside/inside)
			130314, // Enhanced pressure data
			PGN.WIND_DATA, // 130306 - Enhanced wind with gusts
		];
	}

	/**
	 * Get NMEA2000 temperature instance mapping
	 */
	public getTemperatureInstanceMap(): Record<string, number> {
		return {
			"environment.outside.temperature": TEMPERATURE_INSTANCES.OUTSIDE,
			"environment.outside.dewPointTemperature":
				TEMPERATURE_INSTANCES.DEW_POINT,
			"environment.outside.apparentWindChillTemperature":
				TEMPERATURE_INSTANCES.WIND_CHILL,
			"environment.outside.heatIndexTemperature":
				TEMPERATURE_INSTANCES.HEAT_INDEX,
			"environment.outside.realFeelShade":
				TEMPERATURE_INSTANCES.REAL_FEEL_SHADE,
			"environment.outside.apparentTemperature": TEMPERATURE_INSTANCES.APPARENT,
			"environment.outside.wetBulbTemperature": TEMPERATURE_INSTANCES.WET_BULB,
			"environment.outside.wetBulbGlobeTemperature":
				TEMPERATURE_INSTANCES.WET_BULB_GLOBE,
		};
	}

	/**
	 * Get NMEA2000 humidity instance mapping
	 */
	public getHumidityInstanceMap(): Record<string, number> {
		return {
			"environment.outside.relativeHumidity": HUMIDITY_INSTANCES.OUTSIDE,
		};
	}

	/**
	 * Count paths by category for logging
	 * @private
	 */
	private countPathsByCategory(
		values: SignalKValue[],
		category: string,
	): number {
		return values.filter((v) => v.path.includes(category)).length;
	}

	/**
	 * Count enhanced fields (vs basic weather data)
	 * @private
	 */
	private countEnhancedFields(values: SignalKValue[]): number {
		const enhancedPaths = [
			"realFeelShade",
			"wetBulbTemperature",
			"wetBulbGlobeTemperature",
			"windGust",
			"uvIndex",
			"visibility",
			"cloudCover",
			"beaufortScale",
			"absoluteHumidity",
			"airDensity",
			"heatStress",
		];

		return values.filter((v) =>
			enhancedPaths.some((enhanced) => v.path.includes(enhanced)),
		).length;
	}

	/**
	 * Get comprehensive path statistics for monitoring
	 */
	public getPathStatistics(values: SignalKValue[]): {
		total: number;
		temperature: number;
		wind: number;
		humidity: number;
		atmospheric: number;
		calculated: number;
		enhanced: number;
	} {
		return {
			total: values.length,
			temperature: this.countPathsByCategory(values, "temperature"),
			wind: this.countPathsByCategory(values, "wind"),
			humidity: this.countPathsByCategory(values, "humidity"),
			atmospheric: this.countPathsByCategory(values, "environment"),
			calculated: values.filter(
				(v) =>
					v.meta?.description?.includes("calculated") ||
					v.meta?.description?.includes("Calculated"),
			).length,
			enhanced: this.countEnhancedFields(values),
		};
	}

	/**
	 * Validate weather data before mapping
	 */
	public validateWeatherDataForMapping(data: Partial<WeatherData>): boolean {
		const validation = NMEA2000Validator.validateNMEA2000Ranges(data);

		// Log warnings even if validation passes
		if (validation.warnings.length > 0) {
			this.logger("warn", "Weather data validation warnings", {
				warnings: validation.warnings,
			});
		}

		if (!validation.isValid) {
			this.logger("error", "Weather data validation failed", {
				errors: validation.errors,
				warnings: validation.warnings,
			});
			return false;
		}

		return true;
	}
}
