/**
 * Signal K Virtual Weather Sensors - Main Entry Point
 * Modern TypeScript Signal K plugin providing comprehensive AccuWeather integration
 * with enhanced NMEA2000 environmental measurements and sk-n2k-emitter alignment
 */

import type { Plugin, ServerAPI } from "@signalk/server-api";
import { DEFAULT_CONFIG, ERROR_CODES, PLUGIN } from "./constants/index.js";
import { createWeatherProvider } from "./providers/WeatherProviderAdapter.js";
import { WeatherService } from "./services/WeatherService.js";
import type {
	Logger,
	LogLevel,
	PluginConfiguration,
	PluginState,
} from "./types/index.js";
import { ConfigurationValidator } from "./utils/validation.js";

/**
 * Plugin instance state
 */
interface PluginInstance {
	weatherService: WeatherService | null;
	state: PluginState;
	startTime: Date | null;
	logger: Logger;
}

/**
 * Main plugin factory function
 * @param app Signal K server application instance
 * @returns Signal K plugin interface
 */
export default function createPlugin(app: ServerAPI): Plugin {
	const instance: PluginInstance = {
		weatherService: null,
		state: "stopped",
		startTime: null,
		logger: createLogger(app),
	};

	/**
	 * Plugin interface implementation
	 */
	const plugin = {
		id: PLUGIN.NAME,
		name: PLUGIN.DISPLAY_NAME,
		description: PLUGIN.DESCRIPTION,

		/**
		 * Start the plugin with provided configuration
		 */
		start: async (
			settings: object,
			_restartPlugin: (newConfig: object) => void,
		): Promise<void> => {
			try {
				instance.logger(
					"info",
					"Starting signalk-virtual-weather-sensors plugin",
					{
						version: PLUGIN.VERSION,
						settings: Object.keys(settings),
					},
				);

				if (instance.state === "running") {
					instance.logger("warn", "Plugin already running");
					return;
				}

				instance.state = "starting";
				instance.startTime = new Date();
				const config = validateAndNormalizeSettings(settings, instance.logger);

				// Initialize and start weather service (handles its own emission system)
				instance.weatherService = new WeatherService(
					app,
					config,
					instance.logger,
				);
				await instance.weatherService.start();

				instance.state = "running";

				// Register as weather provider
				const provider = createWeatherProvider(
					PLUGIN.NAME,
					async (position) => {
						return (
							instance.weatherService?.fetchWeatherForPosition(position) ?? null
						);
					},
				);
				app.registerWeatherProvider(provider);

				app.setPluginStatus("SK to N2K Weather running");

				instance.logger(
					"info",
					"signalk-virtual-weather-sensors plugin started successfully",
					{
						emissionInterval: config.emissionInterval,
						updateFrequency: config.updateFrequency,
					},
				);
			} catch (error) {
				instance.state = "error";
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				instance.logger("error", "Failed to start plugin", {
					error: errorMessage,
				});

				app.setPluginError(
					`signalk-virtual-weather-sensors startup failed: ${errorMessage}`,
				);

				// Cleanup on failure
				if (instance.weatherService) {
					try {
						await instance.weatherService.stop();
					} catch (_) {
						/* best effort */
					}
					instance.weatherService = null;
				}

				throw error;
			}
		},

		/**
		 * Stop the plugin and cleanup resources
		 */
		stop: async (): Promise<void> => {
			try {
				instance.logger(
					"info",
					"Stopping signalk-virtual-weather-sensors plugin",
				);

				instance.state = "stopping";

				await stopWeatherService(instance);

				const uptime = instance.startTime
					? Date.now() - instance.startTime.getTime()
					: 0;

				instance.state = "stopped";
				instance.startTime = null;

				app.setPluginStatus("SK to N2K Weather stopped");

				instance.logger(
					"info",
					"signalk-virtual-weather-sensors plugin stopped successfully",
					{
						uptimeMs: uptime,
						finalState: instance.state,
					},
				);
			} catch (error) {
				instance.state = "error";
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				instance.logger("error", "Error stopping plugin", {
					error: errorMessage,
				});

				app.setPluginError(
					`signalk-virtual-weather-sensors stop failed: ${errorMessage}`,
				);
			}
		},

		/**
		 * Plugin configuration schema for Signal K server UI
		 */
		schema: () => ({
			type: "object",
			properties: {
				accuWeatherApiKey: {
					type: "string",
					title: "AccuWeather API Key",
					description: "Get your API key at https://developer.accuweather.com/",
					default: "",
				},
				updateFrequency: {
					type: "number",
					title: "Weather Update Frequency",
					description:
						"How often to fetch weather data from AccuWeather API in minutes.",
					default: DEFAULT_CONFIG.UPDATE_FREQUENCY,
					minimum: 1,
					maximum: 60,
				},
				emissionInterval: {
					type: "number",
					title: "Broadcast Interval",
					description:
						"How often to emit weather data to the NMEA2000 network in seconds.",
					default: DEFAULT_CONFIG.EMISSION_INTERVAL,
					minimum: 1,
					maximum: 60,
				},
			},
			required: ["accuWeatherApiKey"],
		}),

		/**
		 * UI schema for better form presentation
		 */
		uiSchema: () => ({
			"ui:order": ["accuWeatherApiKey", "updateFrequency", "emissionInterval"],
			accuWeatherApiKey: {
				"ui:widget": "password",
			},
			updateFrequency: {
				"ui:widget": "updown",
			},
			emissionInterval: {
				"ui:widget": "updown",
			},
		}),

		/**
		 * Get plugin status information
		 */
		getStatus: () => {
			if (!instance.weatherService) {
				return {
					state: instance.state,
					message: "Weather service not initialized",
				};
			}

			const status = instance.weatherService.getServiceStatus();
			const uptime = instance.startTime
				? Date.now() - instance.startTime.getTime()
				: 0;

			return {
				state: status.state,
				uptime,
				lastUpdate: status.lastUpdate,
				lastEmission: status.lastEmission,
				updateCount: status.updateCount,
				emissionCount: status.emissionCount,
				errorCount: status.errorCount,
				hasWeatherData: status.hasWeatherData,
				signalKHealth: status.signalKHealth,
				cacheStats: status.cacheStats,
			};
		},
	};

	return plugin;
}

/**
 * Stop and clean up the weather service
 * @private
 */
async function stopWeatherService(instance: PluginInstance): Promise<void> {
	if (instance.weatherService) {
		try {
			await instance.weatherService.stop();
		} catch (error) {
			instance.logger("error", "Error stopping weather service", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		instance.weatherService = null;
	}
}

/**
 * Validate and normalize plugin settings
 * @private
 */
function validateAndNormalizeSettings(
	settings: object,
	logger: Logger,
): PluginConfiguration {
	const rawSettings = settings as Record<string, unknown>;

	const configBuilder: Record<string, unknown> = {
		accuWeatherApiKey:
			typeof rawSettings.accuWeatherApiKey === "string"
				? rawSettings.accuWeatherApiKey
				: "",
		updateFrequency:
			typeof rawSettings.updateFrequency === "number"
				? rawSettings.updateFrequency
				: DEFAULT_CONFIG.UPDATE_FREQUENCY,
		emissionInterval:
			typeof rawSettings.emissionInterval === "number"
				? rawSettings.emissionInterval
				: DEFAULT_CONFIG.EMISSION_INTERVAL,
	};

	const partialConfig = configBuilder as Partial<PluginConfiguration>;

	const validation =
		ConfigurationValidator.validateConfiguration(partialConfig);
	if (!validation.isValid) {
		const errorMessage = validation.errors.join("; ");
		logger("error", "Configuration validation failed", {
			errors: validation.errors,
			warnings: validation.warnings,
		});
		throw new Error(
			`${ERROR_CODES.CONFIGURATION.INVALID_API_KEY}: ${errorMessage}`,
		);
	}

	if (validation.warnings.length > 0) {
		logger("warn", "Configuration validation warnings", {
			warnings: validation.warnings,
		});
	}

	const finalConfig =
		ConfigurationValidator.sanitizeConfiguration(partialConfig);

	logger("info", "Plugin configuration validated and normalized", {
		updateFrequency: finalConfig.updateFrequency,
		emissionInterval: finalConfig.emissionInterval,
	});

	return finalConfig;
}

/**
 * Create structured logger with plugin context
 * @private
 */
function createLogger(app: ServerAPI): Logger {
	return (
		level: LogLevel,
		message: string,
		metadata?: Record<string, unknown>,
	) => {
		const logMessage = `[${PLUGIN.NAME}] ${message}`;
		const logMetadata = metadata ? ` | ${JSON.stringify(metadata)}` : "";

		switch (level) {
			case "debug":
				app.debug(`${logMessage}${logMetadata}`);
				break;
			case "info":
				app.debug(`INFO: ${logMessage}${logMetadata}`);
				break;
			case "warn":
				app.debug(`WARN: ${logMessage}${logMetadata}`);
				break;
			case "error":
				app.error(`${logMessage}${logMetadata}`);
				break;
		}
	};
}

// Export plugin metadata for Signal K compatibility
export const metadata = {
	id: PLUGIN.NAME,
	name: PLUGIN.DISPLAY_NAME,
	version: PLUGIN.VERSION,
	description: PLUGIN.DESCRIPTION,
	author: PLUGIN.AUTHOR,
	keywords: [
		"signalk-node-server-plugin",
		"signalk-category-weather",
		"nmea2000",
		"weather",
		"accuweather",
		"typescript",
		"enhanced",
	],
} as const;
