/**
 * Weather Provider Adapter
 * Bridges internal weather data to the official Signal K Weather API
 */

import type {
	WeatherData as OfficialWeatherData,
	Position,
	TendencyKind,
	WeatherForecastType,
	WeatherProvider,
	WeatherReqParams,
	WeatherWarning,
} from "@signalk/server-api";
import type { WeatherData as InternalWeatherData } from "../types/index.js";

export function createWeatherProvider(
	pluginId: string,
	getWeatherData: (position: Position) => Promise<InternalWeatherData | null>,
): WeatherProvider {
	return {
		name: "AccuWeather Virtual Weather Sensors",
		methods: {
			pluginId,
			getObservations: async (
				position: Position,
				_options?: WeatherReqParams,
			): Promise<OfficialWeatherData[]> => {
				const data = await getWeatherData(position);
				if (!data) return [];
				return [convertToOfficialFormat(data)];
			},
			getForecasts: async (
				_position: Position,
				_type: WeatherForecastType,
				_options?: WeatherReqParams,
			): Promise<OfficialWeatherData[]> => {
				return [];
			},
			getWarnings: async (_position: Position): Promise<WeatherWarning[]> => {
				return [];
			},
		},
	};
}

function convertToOfficialFormat(
	data: InternalWeatherData,
): OfficialWeatherData {
	const outside: NonNullable<OfficialWeatherData["outside"]> = {
		temperature: data.temperature,
		dewPointTemperature: data.dewPoint,
		pressure: data.pressure,
		relativeHumidity: data.humidity / 100,
		feelsLikeTemperature: data.heatIndex,
	};

	if (data.uvIndex !== undefined) outside.uvIndex = data.uvIndex;
	if (data.cloudCover !== undefined) outside.cloudCover = data.cloudCover;
	if (data.visibility !== undefined)
		outside.horizontalVisibility = data.visibility;
	if (data.absoluteHumidity !== undefined)
		outside.absoluteHumidity = data.absoluteHumidity;
	const tendency = mapPressureTendency(data.pressureTendency);
	if (tendency !== undefined) outside.pressureTendency = tendency;

	const wind: NonNullable<OfficialWeatherData["wind"]> = {
		speedTrue: data.windSpeed,
		directionTrue: data.windDirection,
	};
	if (data.windGustSpeed !== undefined) wind.gust = data.windGustSpeed;

	const result: OfficialWeatherData = {
		date: data.timestamp,
		type: "observation",
		outside,
		wind,
	};
	if (data.description !== undefined) result.description = data.description;
	return result;
}

function mapPressureTendency(tendency?: string): TendencyKind | undefined {
	if (!tendency) return undefined;
	const lower = tendency.toLowerCase();
	if (lower === "rising" || lower === "increasing") return "increasing";
	if (lower === "falling" || lower === "decreasing") return "decreasing";
	if (lower === "steady") return "steady";
	return "not available";
}
