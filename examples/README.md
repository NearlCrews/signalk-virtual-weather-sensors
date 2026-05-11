# Example Configurations

Sample plugin configurations for `signalk-virtual-weather-sensors`. Drop the
contents of any file into the plugin's settings JSON in the Signal K Admin UI
(or write it to your server's `~/.signalk/plugin-config-data/signalk-virtual-weather-sensors.json`),
replacing the placeholder API key with your own from
[developer.accuweather.com](https://developer.accuweather.com/).

The plugin always reads its location from `navigation.position` on the self
vessel: there is no fixed-coordinates option. A working GPS feed (or a manually
published `navigation.position`) is required.

## Files

- **`sailboat.json`**: Default 5-minute weather refresh, 5-second emission to
  the NMEA2000 bus. A balanced profile that fits comfortably inside the
  AccuWeather free tier (50 calls/day = 12 calls/hour ceiling) and gives plotters
  a steady heartbeat.

- **`powerboat.json`**: 2-minute weather refresh for faster-changing conditions
  while underway at higher speeds. Burns ~720 calls/day, so this profile
  requires a paid AccuWeather tier or a key with a higher quota.

- **`slow-update.json`**: 15-minute weather refresh, 10-second emission. Use
  with a free-tier key when you also have other AccuWeather consumers on the
  same key, or when atmospheric conditions in your cruising area change slowly.
  ~96 calls/day.

## Settings reference

| Setting | Default | Range | Notes |
|---------|---------|-------|-------|
| `accuWeatherApiKey` | (required) | min 20 chars | Key from developer.accuweather.com |
| `updateFrequency` | 5 | 1 to 60 minutes | How often to fetch from AccuWeather |
| `emissionInterval` | 5 | 1 to 60 seconds | How often to re-emit cached data to NMEA2000 |
| `dailyApiQuota` | 50 | 0 to 1000 calls | Rolling 24h cap; 0 disables. Banner shows `K/Q today` and warns at 90%; at 100% the plugin pauses fetches. |
