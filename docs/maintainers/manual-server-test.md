# Manual Server-Test Checklist

Reproducible end-to-end check of `signalk-virtual-weather-sensors` running against a real Signal K server. Budget: about 30 minutes for a competent operator. Every UI string and path below is verbatim from the current code; deviations indicate a regression.

## 0. Pre-flight

- [ ] **Signal K server version recorded.** Run `signalk-server --version` on the host. The plugin depends on `@signalk/server-api >=2.24.0` (per `package.json` `peerDependencies`), which the server provides at runtime.
- [ ] **Server is running and reachable.** Default Admin UI is at `http://<host>:3000/admin/`.
- [ ] **AccuWeather API key in hand.** Get a key from <https://developer.accuweather.com/>. This checklist exercises the AccuWeather source; the default source is keyless Open-Meteo, which emits `$source: open-meteo` with a smaller field set. The plugin tolerates the missing `Precip1hr` / `Past24HourTemperatureDeparture` fields some keys do not include.
- [ ] **Vessel `navigation.position` is being published.** The plugin needs a position to query the weather provider. Confirm in the Admin UI **Data Browser** that `vessels.self.navigation.position` has a current value (any source: GPS, sim, or manual `PUT`).
- [ ] **Plugin built locally.** From the repo root: `npm install && npm run build`. Confirm `dist/index.js` exists.
- [ ] **Plugin symlinked into the server.** `ln -s "$(pwd)" ~/.signalk/node_modules/signalk-virtual-weather-sensors`. Restart the server: `sudo systemctl restart signalk` (or whatever supervises it).
- [ ] **Plugin appears in Admin UI.** Open **Server -> Plugin Config**. Confirm an entry titled **Signal K Virtual Weather Sensors** is listed.

## 1. Configuration in the Admin UI

- [ ] Open **Server -> Plugin Config -> Signal K Virtual Weather Sensors**.
- [ ] Toggle **Active** on.
- [ ] The panel shows a **Status** card followed by three collapsed sections (**Weather source**, **Fetch and emission cadence**, **Severe-weather notifications**). Click a section header to expand it before editing its fields.
- [ ] In **Weather source**, set **Provider** to the AccuWeather option. The default is Open-Meteo (keyless); selecting AccuWeather reveals the **AccuWeather API Key** field and emits `$source: accuweather`, which the rest of this checklist verifies.
- [ ] Paste the AccuWeather key into **AccuWeather API Key**.
- [ ] Leave **Update Frequency (minutes)** at the default `30` for the test run (or temporarily lower it to 1 to speed up verification, then restore before regular use).
- [ ] Leave **Broadcast interval (seconds)** at the default `5` for the test run.
- [ ] Leave **Daily API Call Quota** at the default `50` for a default-quota check, OR raise it to your plan limit to skip the quota verification step at the end.
- [ ] Click **Save** in the sticky footer (enabled once the form has unsaved changes). The plugin restarts and the panel confirms the restart.
- [ ] Within ~10 seconds the status banner under the plugin name should change from `Stopped` to `Running, awaiting first update` (or `Running, awaiting first update (0/50 today)` when the quota is on).
- [ ] Within `Update Frequency` minutes (default 30; the plugin schedules its first fetch on a short startup timer roughly 5 seconds after start) the banner should switch to `Running, last update just now (1 update, 2 API requests)` (the first cycle costs one location-search call plus one current-conditions call). With `dailyApiQuota > 0` the suffix gains `, 2/50 today`. Subsequent updates show `(N updates, M API requests, M/Q today)` with the counters climbing.

## 2. Path-by-path verification (Data Browser)

Open **Server -> Data Browser**. Filter by `vessels.self`. For each path below
confirm the listed value appears with `$source: accuweather` and the provider's
observation `timestamp`. The timestamp stays unchanged between weather fetches
even though the cached delta is rebroadcast at the configured interval.

### Canonical `environment.outside.*` (must be present)

- [ ] `environment.outside.temperature` (K, roughly 250 to 320)
- [ ] `environment.outside.pressure` (Pa, roughly 95000 to 105000)
- [ ] `environment.outside.relativeHumidity` (ratio 0 to 1)
- [ ] `environment.outside.dewPointTemperature` (K)
- [ ] `environment.outside.apparentWindChillTemperature` (K, present only when
  fresh vessel motion and course data allow apparent wind to be calculated)
- [ ] `environment.outside.theoreticalWindChillTemperature` (K, wind chill from the true wind)
- [ ] `environment.outside.heatIndexTemperature` (K, computed NWS heat index, not AccuWeather RealFeel)
- [ ] `environment.outside.airDensity` (kg/m3, roughly 1.0 to 1.4)

### Canonical `environment.wind.*`

- [ ] `environment.wind.speedOverGround` (m/s)
- [ ] `environment.wind.directionTrue` (rad, 0 to ~6.28)
- [ ] **`environment.wind.speedTrue` is absent.** AccuWeather wind is ground-referenced; the plugin deliberately does not emit `speedTrue`. Its presence would indicate a regression.
- [ ] **`environment.wind.speedApparent` and `environment.wind.angleApparent` are absent.** Calculated apparent wind is producer-namespaced (`environment.weather.windSpeedApparent` / `windAngleApparent`, listed below); it deliberately does not squat the canonical apparent leaves a masthead anemometer owns.

### Producer-namespaced `environment.weather.*`

- [ ] `environment.weather.uvIndex`
- [ ] `environment.weather.visibility` (m)
- [ ] `environment.weather.cloudCover` (ratio 0 to 1)
- [ ] `environment.weather.cloudCeiling` (m)
- [ ] `environment.weather.absoluteHumidity` (kg/m3)
- [ ] `environment.weather.realFeel` (K, AccuWeather RealFeel; may be absent on some plans)
- [ ] `environment.weather.realFeelShade` (K)
- [ ] `environment.weather.wetBulbTemperature` (K)
- [ ] `environment.weather.wetBulbGlobeTemperature` (K)
- [ ] `environment.weather.apparentTemperature` (K)
- [ ] `environment.weather.temperatureDeparture24h` (K delta, may be absent on some plans; data browser should show a Kelvin delta, not an absolute temperature)
- [ ] `environment.weather.precipitationLastHour` (m, may be absent on some plans; data browser should show mm, not miles)
- [ ] `environment.weather.speedGust` (m/s)
- [ ] `environment.weather.gustFactor` (ratio, may be absent when wind is calm)
- [ ] `environment.weather.windSpeedApparent` (m/s, present only when `navigation.speedOverGround` and a course over ground are available)
- [ ] `environment.weather.windAngleApparent` (rad, -pi..pi, negative to port)
- [ ] `environment.weather.beaufortScale` (0..12)
- [ ] `environment.weather.heatStressIndex` (0..4, present only when WBGT is)
- [ ] `environment.weather.description` (string, plain-language condition summary)
- [ ] `environment.weather.pressureTendency` (-1 falling, 0 steady, +1 rising; AccuWeather only)
- [ ] `environment.weather.precipitationType` (string, present only during precipitation; AccuWeather only)
- [ ] `environment.weather.visibilityObstruction` (string, present only when obstructed; AccuWeather only)

### Meta verification

- [ ] In the Data Browser, click any `environment.weather.*` path. The right-hand details panel shows `units` (e.g. `K`, `m`, `m/s`, `ratio`) and a `displayName`. Confirm both are populated. The plugin ships these once at startup via a meta delta.

### Optional: sea state (`environment.water.*`, when **Emit sea state** is on)

Enable **Emit sea state** in **Weather source**, save, and (for a coastal or offshore position) confirm these appear with `$source: open-meteo-marine`. Inland points have no marine data, so the layer emits nothing there.

- [ ] `environment.water.temperature` (K)
- [ ] `environment.current` (object node with `drift` in m/s and `setTrue` in rad)
- [ ] `environment.water.waves.significantHeight` (m), `waves.period` (s), and `waves.direction` (rad)
- [ ] `environment.water.swell.height` (m), `swell.period` (s), and `swell.direction` (rad)

## 3. Status banner verification

- [ ] In **Plugin Config**, confirm the status banner under **Signal K Virtual Weather Sensors** matches the format `Running, last update <Nm ago | just now> (<N> updates, <M> API requests)`. With `dailyApiQuota > 0` the suffix continues `, <M>/<Q> today`.
- [ ] Wait at least one full **Update Frequency** cycle (default 30 minutes; or however long you set it during Section 1). Refresh the page. The `<N> updates` counter must increment by at least 1.
- [ ] The `<Nm ago>` value must reset to `just now` immediately after each fetch and grow over time.

### Quota verification (skip if `dailyApiQuota = 0`)

- [ ] Set `dailyApiQuota` to a low value (e.g. 3) and `updateFrequency` to 1 minute. Submit. Wait long enough for the rolling 24h count to cross 90% of the cap.
- [ ] The banner prefix should switch from `Running` to `Running [quota 90% used]`.
- [ ] Continue waiting until the count reaches the cap. The banner should switch to a red error reading `AccuWeather daily quota reached (3/3 in last 24h). Fetches paused until the rolling window drops below the cap. To resume sooner, raise dailyApiQuota or increase updateFrequency.` (the banner names the active weather source) and the `<N> updates` counter should stop climbing.
- [ ] Restore `dailyApiQuota` to its production value (or 0 to disable). Submit. New fetches resume on the next cycle.

## 4. Error path verification

- [ ] In **Plugin Config**, replace the API key with `0000000000000000000000` (22 chars, valid format, invalid value). Submit.
- [ ] Within one fetch cycle (or immediately, on the next forced retry) the banner should switch from green/grey `Running, ...` to a red error banner reading `AccuWeather rejected the configured API key. Update the key in plugin settings: ...` (the auth-rejection escalation that stops the update timer to protect your quota). If a previously-good key was cached, you may instead see `Weather data stale: last update N minutes ago` until the consecutive-failure threshold trips. Note the admin UI prefixes banner text with the plugin display name, so no `signalk-virtual-weather-sensors` package-name prefix appears in the message itself.
- [ ] Open **Server -> Server Log**. Filter for `signalk-virtual-weather-sensors`. You should see a `[ERROR]`-prefixed line referencing `API_UNAUTHORIZED` (HTTP 401 from AccuWeather) or `API_FORBIDDEN` (HTTP 403). If you only see `[DEBUG]` lines, the routing fix in 1.3.3 has regressed.
- [ ] Restore the correct API key. Submit. The banner clears back to `Running, ...` on the next successful fetch (the 1.3.1 stale-recovery flag handles this). If it does not, force a plugin restart with the toggle.

## 5. Cleanup

- [ ] In **Plugin Config**, toggle **Active** off. Submit. The banner switches to `Stopped`.
- [ ] Any active `notifications.environment.*` paths owned by the plugin return
  to `state: normal` when the plugin stops.
- [ ] All `accuweather`-sourced paths in the Data Browser stop updating; their `timestamp` ages and they fall out of the panel after a server-configured retention window.
- [ ] To uninstall completely: `rm ~/.signalk/node_modules/signalk-virtual-weather-sensors` and restart the server. The plugin entry disappears from **Plugin Config**.
- [ ] If desired, `rm ~/.signalk/plugin-config-data/signalk-virtual-weather-sensors.json` to clear the persisted API key.
