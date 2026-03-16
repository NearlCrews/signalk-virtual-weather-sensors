/**
 * WeatherProviderAdapter Test Suite
 * Tests the bridge between internal weather data and the official Signal K Weather API
 */

import { describe, expect, it } from "vitest";
import { createWeatherProvider } from "../../providers/WeatherProviderAdapter.js";
import { createMockWeatherData } from "../setup.js";

describe("WeatherProviderAdapter", () => {
	describe("createWeatherProvider", () => {
		it("should create a provider with correct name and pluginId", () => {
			const provider = createWeatherProvider("test-plugin", async () => null);

			expect(provider.name).toBe("AccuWeather Virtual Weather Sensors");
			expect(provider.methods.pluginId).toBe("test-plugin");
		});

		it("should return empty observations when no data available", async () => {
			const provider = createWeatherProvider("test-plugin", async () => null);
			const result = await provider.methods.getObservations({
				latitude: 37.77,
				longitude: -122.42,
			});

			expect(result).toEqual([]);
		});

		it("should convert internal weather data to official format", async () => {
			const mockData = createMockWeatherData({
				temperature: 293.15,
				pressure: 101325,
				humidity: 65,
				windSpeed: 5.14,
				windDirection: Math.PI / 2,
				dewPoint: 286.48,
				heatIndex: 293.15,
				windGustSpeed: 8.5,
				uvIndex: 3,
				cloudCover: 0.75,
				visibility: 16000,
				absoluteHumidity: 0.012,
				pressureTendency: "Rising",
			});

			const provider = createWeatherProvider(
				"test-plugin",
				async () => mockData,
			);
			const result = await provider.methods.getObservations({
				latitude: 37.77,
				longitude: -122.42,
			});

			expect(result).toHaveLength(1);
			const obs = result[0];

			expect(obs).toBeDefined();
			expect(obs?.type).toBe("observation");
			expect(obs?.date).toBe(mockData.timestamp);
			expect(obs?.outside?.temperature).toBe(293.15);
			expect(obs?.outside?.pressure).toBe(101325);
			expect(obs?.outside?.relativeHumidity).toBe(0.65); // converted from percentage to ratio
			expect(obs?.outside?.dewPointTemperature).toBe(286.48);
			expect(obs?.outside?.feelsLikeTemperature).toBe(293.15);
			expect(obs?.outside?.uvIndex).toBe(3);
			expect(obs?.outside?.cloudCover).toBe(0.75);
			expect(obs?.outside?.horizontalVisibility).toBe(16000);
			expect(obs?.outside?.absoluteHumidity).toBe(0.012);
			expect(obs?.outside?.pressureTendency).toBe("increasing");
			expect(obs?.wind?.speedTrue).toBe(5.14);
			expect(obs?.wind?.directionTrue).toBe(Math.PI / 2);
			expect(obs?.wind?.gust).toBe(8.5);
		});

		it("should map pressure tendency correctly", async () => {
			const testCases = [
				{ input: "Rising", expected: "increasing" },
				{ input: "Falling", expected: "decreasing" },
				{ input: "Steady", expected: "steady" },
				{ input: "Unknown", expected: "not available" },
			];

			for (const tc of testCases) {
				const mockData = createMockWeatherData({ pressureTendency: tc.input });
				const provider = createWeatherProvider(
					"test-plugin",
					async () => mockData,
				);
				const result = await provider.methods.getObservations({
					latitude: 0,
					longitude: 0,
				});
				expect(result[0]?.outside?.pressureTendency).toBe(tc.expected);
			}
		});

		it("should return empty forecasts", async () => {
			const provider = createWeatherProvider("test-plugin", async () => null);
			const result = await provider.methods.getForecasts(
				{ latitude: 0, longitude: 0 },
				"daily",
			);

			expect(result).toEqual([]);
		});

		it("should return empty warnings", async () => {
			const provider = createWeatherProvider("test-plugin", async () => null);
			const result = await provider.methods.getWarnings({
				latitude: 0,
				longitude: 0,
			});

			expect(result).toEqual([]);
		});
	});
});
