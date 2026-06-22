/**
 * Met.no Locationforecast 2.0 (/complete) response. GeoJSON Feature whose
 * properties.timeseries[] entries each carry an instant.details block (the
 * current value is the first entry) and optional period blocks. Units: air and
 * dew-point temperature Celsius, air_pressure_at_sea_level hPa, relative_humidity
 * and cloud_area_fraction percent, wind_speed and wind_speed_of_gust m/s,
 * wind_from_direction degrees, precipitation_amount mm. Only mapped fields are
 * typed, all optional. The /complete variant is required because /compact omits
 * dew_point_temperature and ultraviolet_index_clear_sky.
 */
interface MetNoInstantDetails {
  readonly air_temperature?: number;
  readonly air_pressure_at_sea_level?: number;
  readonly relative_humidity?: number;
  readonly dew_point_temperature?: number;
  readonly cloud_area_fraction?: number;
  readonly wind_speed?: number;
  readonly wind_speed_of_gust?: number;
  readonly wind_from_direction?: number;
  readonly ultraviolet_index_clear_sky?: number;
}

interface MetNoPeriod {
  readonly summary?: { readonly symbol_code?: string };
  readonly details?: {
    readonly precipitation_amount?: number;
    readonly air_temperature_max?: number;
    readonly air_temperature_min?: number;
  };
}

export interface MetNoTimeseriesEntry {
  readonly time?: string;
  readonly data?: {
    readonly instant?: { readonly details?: MetNoInstantDetails };
    readonly next_1_hours?: MetNoPeriod;
    readonly next_6_hours?: MetNoPeriod;
    readonly next_12_hours?: MetNoPeriod;
  };
}

export interface MetNoLocationforecastResponse {
  readonly properties?: { readonly timeseries?: ReadonlyArray<MetNoTimeseriesEntry> };
}
