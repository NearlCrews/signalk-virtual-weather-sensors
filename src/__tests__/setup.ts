/**
 * Vitest test setup and global configuration
 * Provides mocks, utilities, and test environment setup
 */

import type { MockedFunction } from "vitest";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";

// ===============================
// Global Test Setup
// ===============================

/** Configure global test environment before all tests */
beforeAll(() => {
	// Mock console methods to reduce test noise
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});

	// Setup global test timeout
	vi.setConfig({ testTimeout: 10000 });
});

/** Cleanup after each test */
afterEach(() => {
	// Clear all mocks but keep implementations
	vi.clearAllMocks();

	// Reset any modified timers
	vi.useRealTimers();
});

/** Cleanup after all tests */
afterAll(() => {
	// Restore all original implementations
	vi.restoreAllMocks();
});

// ===============================
// Mock Data Generators
// ===============================

/**
 * Generate mock weather data for testing
 */
export function createMockWeatherData(
	overrides: Partial<import("../types/index.js").WeatherData> = {},
): import("../types/index.js").WeatherData {
	return {
		temperature: 293.15, // 20°C in Kelvin
		pressure: 101325, // 1013.25 mbar in Pascals
		humidity: 65, // 65% (percentage format for Garmin compatibility)
		windSpeed: 5.14, // ~10 knots in m/s
		windDirection: Math.PI / 2, // 90° (East) in radians
		dewPoint: 286.48, // ~13.3°C in Kelvin
		windChill: 293.15, // Same as temp for mild conditions
		heatIndex: 293.15, // Same as temp for mild conditions
		description: "Partly cloudy",
		timestamp: new Date().toISOString(),
		quality: 1.0,
		...overrides,
	};
}

/**
 * Generate mock vessel navigation data for testing
 */
export function createMockVesselData(
	overrides: Partial<import("../types/index.js").VesselNavigationData> = {},
): import("../types/index.js").VesselNavigationData {
	return {
		position: {
			latitude: 37.7749,
			longitude: -122.4194,
		},
		speedOverGround: 2.57, // ~5 knots in m/s
		courseOverGroundTrue: 0, // North in radians
		headingTrue: 0, // North in radians
		headingMagnetic: 0.087, // ~5° magnetic deviation
		isComplete: true,
		dataAge: 1000, // 1 second
		...overrides,
	};
}

/**
 * Generate mock plugin configuration for testing
 */
export function createMockConfig(
	overrides: Partial<import("../types/index.js").PluginConfiguration> = {},
): import("../types/index.js").PluginConfiguration {
	return {
		accuWeatherApiKey: "test-api-key-12345",
		updateFrequency: 5,
		emissionInterval: 5,
		...overrides,
	};
}

/**
 * Generate mock AccuWeather API response for testing
 */
export function createMockAccuWeatherResponse(
	overrides: Partial<
		import("../types/index.js").AccuWeatherCurrentConditions
	> = {},
): import("../types/index.js").AccuWeatherCurrentConditions[] {
	return [
		{
			LocalObservationDateTime: new Date().toISOString(),
			EpochTime: Date.now() / 1000,
			WeatherText: "Partly cloudy",
			WeatherIcon: 3,
			HasPrecipitation: false,
			PrecipitationType: null,
			IsDayTime: true,
			Temperature: {
				Metric: { Value: 20, Unit: "C" },
				Imperial: { Value: 68, Unit: "F" },
			},
			RealFeelTemperature: {
				Metric: { Value: 20.5, Unit: "C", Phrase: "Pleasant" },
				Imperial: { Value: 69, Unit: "F", Phrase: "Pleasant" },
			},
			RealFeelTemperatureShade: {
				Metric: { Value: 19.2, Unit: "C", Phrase: "Pleasant" },
				Imperial: { Value: 66, Unit: "F", Phrase: "Pleasant" },
			},
			RelativeHumidity: 65,
			IndoorRelativeHumidity: 70,
			Wind: {
				Speed: {
					Metric: { Value: 18.5, Unit: "km/h" },
					Imperial: { Value: 11.5, Unit: "mi/h" },
				},
				Direction: {
					Degrees: 90,
					Localized: "E",
					English: "E",
				},
			},
			WindGust: {
				Speed: {
					Metric: { Value: 25.0, Unit: "km/h" },
					Imperial: { Value: 15.5, Unit: "mi/h" },
				},
			},
			Pressure: {
				Metric: { Value: 1013.25, Unit: "mb" },
				Imperial: { Value: 29.92, Unit: "inHg" },
			},
			PressureTendency: {
				LocalizedText: "Steady",
				Code: "S",
			},
			DewPoint: {
				Metric: { Value: 13.3, Unit: "C" },
				Imperial: { Value: 56, Unit: "F" },
			},
			ApparentTemperature: {
				Metric: { Value: 20, Unit: "C" },
				Imperial: { Value: 68, Unit: "F" },
			},
			WindChillTemperature: {
				Metric: { Value: 20, Unit: "C" },
				Imperial: { Value: 68, Unit: "F" },
			},
			WetBulbTemperature: {
				Metric: { Value: 16.8, Unit: "C" },
				Imperial: { Value: 62, Unit: "F" },
			},
			WetBulbGlobeTemperature: {
				Metric: { Value: 17.5, Unit: "C" },
				Imperial: { Value: 63, Unit: "F" },
			},
			UVIndex: 3,
			UVIndexFloat: 3.2,
			UVIndexText: "Moderate",
			Visibility: {
				Metric: { Value: 16.0, Unit: "km" },
				Imperial: { Value: 10, Unit: "mi" },
			},
			CloudCover: 75,
			Ceiling: {
				Metric: { Value: 1200, Unit: "m" },
				Imperial: { Value: 4000, Unit: "ft" },
			},
			ObstructionsToVisibility: "",
			Past24HourTemperatureDeparture: {
				Metric: { Value: 1.5, Unit: "C" },
				Imperial: { Value: 3, Unit: "F" },
			},
			Precip1hr: {
				Metric: { Value: 0, Unit: "mm" },
				Imperial: { Value: 0, Unit: "in" },
			},
			PrecipitationSummary: {
				Precipitation: {
					Metric: { Value: 0, Unit: "mm" },
					Imperial: { Value: 0, Unit: "in" },
				},
				PastHour: {
					Metric: { Value: 0, Unit: "mm" },
					Imperial: { Value: 0, Unit: "in" },
				},
				Past3Hours: {
					Metric: { Value: 0, Unit: "mm" },
					Imperial: { Value: 0, Unit: "in" },
				},
				Past6Hours: {
					Metric: { Value: 0, Unit: "mm" },
					Imperial: { Value: 0, Unit: "in" },
				},
				Past12Hours: {
					Metric: { Value: 0, Unit: "mm" },
					Imperial: { Value: 0, Unit: "in" },
				},
				Past24Hours: {
					Metric: { Value: 0, Unit: "mm" },
					Imperial: { Value: 0, Unit: "in" },
				},
			},
			TemperatureSummary: {
				Past6HourRange: {
					Minimum: {
						Metric: { Value: 18, Unit: "C" },
						Imperial: { Value: 64, Unit: "F" },
					},
					Maximum: {
						Metric: { Value: 22, Unit: "C" },
						Imperial: { Value: 72, Unit: "F" },
					},
				},
				Past12HourRange: {
					Minimum: {
						Metric: { Value: 16, Unit: "C" },
						Imperial: { Value: 61, Unit: "F" },
					},
					Maximum: {
						Metric: { Value: 24, Unit: "C" },
						Imperial: { Value: 75, Unit: "F" },
					},
				},
				Past24HourRange: {
					Minimum: {
						Metric: { Value: 15, Unit: "C" },
						Imperial: { Value: 59, Unit: "F" },
					},
					Maximum: {
						Metric: { Value: 25, Unit: "C" },
						Imperial: { Value: 77, Unit: "F" },
					},
				},
			},
			MobileLink: "http://www.accuweather.com/test",
			Link: "http://www.accuweather.com/test",
			...overrides,
		},
	];
}

/**
 * Generate mock Signal K delta message for testing
 */
export function createMockSignalKDelta(
	overrides: Record<string, unknown> = {},
) {
	return {
		context: "vessels.self",
		updates: [
			{
				source: {
					label: "Signal K Virtual Weather Sensors",
					type: "plugin",
					bus: "/dev/actisense",
				},
				timestamp: new Date().toISOString(),
				values: [
					{ path: "environment.outside.temperature", value: 293.15 },
					{ path: "environment.outside.pressure", value: 101325 },
					{ path: "environment.outside.relativeHumidity", value: 65 },
				],
			},
		],
		...overrides,
	};
}

// ===============================
// Mock Implementations
// ===============================

/**
 * Mock fetch implementation for API testing
 */
export function createMockFetch(
	responseData: unknown,
	options: { status?: number; ok?: boolean } = {},
) {
	const mockResponse = {
		ok: options.ok ?? true,
		status: options.status ?? 200,
		json: vi.fn().mockResolvedValue(responseData),
		text: vi.fn().mockResolvedValue(JSON.stringify(responseData)),
	};

	return vi.fn().mockResolvedValue(mockResponse);
}

/**
 * Mock Signal K app for plugin testing
 */
export function createMockSignalKApp() {
	const mockApp = {
		debug: vi.fn(),
		error: vi.fn(),
		setPluginStatus: vi.fn(),
		setPluginError: vi.fn(),
		getSelfPath: vi.fn().mockReturnValue("vessels.self"),
		streambundle: {
			getBus: vi.fn().mockReturnValue({
				on: vi.fn(),
				off: vi.fn(),
				emit: vi.fn(),
			}),
		},
		handleMessage: vi.fn(),
		registerWeatherProvider: vi.fn(),
		emit: vi.fn(),
	};

	return mockApp;
}

/**
 * Mock timer utilities for testing time-dependent code
 */
export function createMockTimers() {
	vi.useFakeTimers();

	return {
		advanceTime: (ms: number) => vi.advanceTimersByTime(ms),
		advanceToNext: () => vi.advanceTimersToNextTimer(),
		runAllTimers: () => vi.runAllTimers(),
		clearAllTimers: () => vi.clearAllTimers(),
		useRealTimers: () => vi.useRealTimers(),
	};
}

// ===============================
// Test Utilities
// ===============================

/**
 * Utility to wait for async operations in tests
 */
export function waitFor(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Utility to wait for a condition to be true
 */
export async function waitForCondition(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();

	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await waitFor(interval);
	}

	throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Utility to create a mock that tracks call order
 */
export function createOrderedMock() {
	const calls: Array<{ name: string; args: unknown[] }> = [];

	const createMockFn = (name: string) => {
		const fn = vi.fn((...args: unknown[]) => {
			calls.push({ name, args });
		});
		return fn;
	};

	return {
		createMockFn,
		getCalls: () => [...calls],
		clearCalls: () => calls.splice(0, calls.length),
	};
}

/**
 * Utility to test error conditions
 */
export function expectToThrow<T extends Error>(
	fn: () => void | Promise<void>,
	errorType?: new () => T,
	message?: string | RegExp,
) {
	if (errorType) {
		expect(fn).toThrow(errorType);
	} else {
		expect(fn).toThrow();
	}

	if (message) {
		expect(fn).toThrow(message);
	}
}

/**
 * Utility for testing with different time zones
 */
export function withTimeZone<T>(timeZone: string, fn: () => T): T {
	const originalTZ = process.env.TZ;
	process.env.TZ = timeZone;

	try {
		return fn();
	} finally {
		if (originalTZ) {
			process.env.TZ = originalTZ;
		} else {
			process.env.TZ = undefined;
		}
	}
}

// ===============================
// Custom Matchers
// ===============================

/**
 * Custom matcher for testing numeric values with tolerance
 */
expect.extend({
	toBeCloseTo(received: number, expected: number, precision = 2) {
		const pass = Math.abs(received - expected) < 10 ** -precision;

		if (pass) {
			return {
				message: () => `expected ${received} not to be close to ${expected}`,
				pass: true,
			};
		}
		return {
			message: () => `expected ${received} to be close to ${expected}`,
			pass: false,
		};
	},
});

/**
 * Custom matcher for testing Signal K delta structure
 */
expect.extend({
	toBeValidSignalKDelta(received: unknown) {
		if (typeof received !== "object" || received === null) {
			return {
				message: () => "expected value to be a Signal K delta object",
				pass: false,
			};
		}

		const delta = received as Record<string, unknown>;
		const hasContext = "context" in delta && typeof delta.context === "string";
		const hasUpdates = "updates" in delta && Array.isArray(delta.updates);

		if (hasContext && hasUpdates) {
			return {
				message: () => "expected value not to be a valid Signal K delta",
				pass: true,
			};
		}
		return {
			message: () =>
				"expected value to be a valid Signal K delta with context and updates",
			pass: false,
		};
	},
});

// ===============================
// Type Exports
// ===============================

export type MockedFetch = MockedFunction<typeof fetch>;
export type MockedSignalKApp = ReturnType<typeof createMockSignalKApp>;
export type MockedTimers = ReturnType<typeof createMockTimers>;
