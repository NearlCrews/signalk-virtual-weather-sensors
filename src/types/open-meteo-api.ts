/**
 * Open-Meteo API response shapes for signalk-virtual-weather-sensors.
 * All fields are optional because Open-Meteo omits a variable when it is not
 * requested or is unavailable for the point.
 */

/**
 * Open-Meteo `/v1/forecast` current-block response. Only the fields the plugin
 * maps are typed, and all are optional because Open-Meteo omits a variable when
 * it is not requested or is unavailable for the point. The service requests
 * `wind_speed_unit=ms`, so `wind_speed_10m` and `wind_gusts_10m` are m/s;
 * `pressure_msl` is hPa, temperatures are Celsius, `visibility` is meters, and
 * `cloud_cover` and `relative_humidity_2m` are percentages.
 */
export interface OpenMeteoCurrentResponse {
  readonly current?: {
    readonly time?: string;
    readonly temperature_2m?: number;
    readonly relative_humidity_2m?: number;
    readonly apparent_temperature?: number;
    readonly precipitation?: number;
    readonly weather_code?: number;
    readonly cloud_cover?: number;
    readonly pressure_msl?: number;
    readonly wind_speed_10m?: number;
    readonly wind_direction_10m?: number;
    readonly wind_gusts_10m?: number;
    readonly dew_point_2m?: number;
    readonly visibility?: number;
    readonly uv_index?: number;
  };
}

/**
 * Open-Meteo Marine `/v1/marine` current-block response. Only the fields the
 * plugin maps are typed, all optional. Wave and swell heights are meters,
 * periods seconds, directions degrees; `ocean_current_velocity` is km/h and
 * `sea_surface_temperature` is Celsius.
 */
export interface OpenMeteoMarineResponse {
  readonly current?: {
    readonly time?: string;
    readonly wave_height?: number;
    readonly wave_direction?: number;
    readonly wave_period?: number;
    readonly wind_wave_height?: number;
    readonly swell_wave_height?: number;
    readonly swell_wave_direction?: number;
    readonly swell_wave_period?: number;
    readonly ocean_current_velocity?: number;
    readonly ocean_current_direction?: number;
    readonly sea_surface_temperature?: number;
  };
}
