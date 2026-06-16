/**
 * React config panel for signalk-virtual-weather-sensors.
 *
 * Loaded by the Signal K Admin UI v2.13+ via Module Federation (see
 * webpack.config.cjs). The `signalk-plugin-configurator` keyword in
 * package.json is what triggers the host to load this panel in place of the
 * default rjsf-rendered form.
 *
 * Receives two props from the host:
 *   - `configuration`: the current saved plugin config object
 *   - `save(newConfig)`: persists the config and restarts the plugin
 *
 * Composition root only: live polling lives in hooks/useStatus, form state
 * and the save-confirm flow in hooks/usePanelConfig, presentation in
 * components/. All colors flow through the --svws-* tokens in styles.ts.
 */

import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  CONFIG_DEFAULTS,
  NOTIFICATION_BAND_KEYS,
  QUOTA_WARN_RATIO,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
  type WeatherProviderId,
} from '../constants/notifications-shared.js';
import ApiKeyField from './components/ApiKeyField.js';
import FooterBar from './components/FooterBar.js';
import NotificationToggles from './components/NotificationToggles.js';
import NumberInput from './components/NumberInput.js';
import Section from './components/Section.js';
import StatusDashboard from './components/StatusDashboard.js';
import ThemeToggle from './components/ThemeToggle.js';
import { usePanelConfig } from './hooks/usePanelConfig.js';
import { useStatus } from './hooks/useStatus.js';
import { S, THEME_STYLE } from './styles.js';

interface Props {
  configuration: unknown;
  save: (configuration: unknown) => unknown;
}

type SectionKey = 'apiKey' | 'cadence' | 'notifications';

export default function PluginConfigurationPanel({
  configuration,
  save,
}: Props): React.ReactElement {
  const { status, error, lastUpdatedMs, lastAttemptMs, stale, loading, refresh } = useStatus();
  const {
    form,
    savedForm,
    dirty,
    saving,
    action,
    keyError,
    setField,
    setNotification,
    discard,
    clearKeyError,
    doSave,
  } = usePanelConfig(configuration, save, refresh);

  // Config sections collapse by default: the panel opens as a Status summary
  // and the operator expands only the section they came to edit.
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    apiKey: false,
    cadence: false,
    notifications: false,
  });
  const toggleSection = (key: SectionKey): void =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Warn before a tab close or reload while edits are unsaved. The handler is
  // only registered while dirty and torn down once clean or unmounted.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Legacy browsers require a returnValue to trigger the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // First run: AccuWeather selected, not running, and no saved key means the
  // next step is always "add a key", so surface the callout and open the source
  // section once. Keyless Open-Meteo runs without a key, so it never triggers.
  const firstRun =
    status !== null &&
    !status.running &&
    savedForm.weatherProvider === 'accuweather' &&
    savedForm.accuWeatherApiKey.trim() === '';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (firstRun && !autoOpened.current) {
      autoOpened.current = true;
      setOpenSections((prev) => ({ ...prev, apiKey: true }));
    }
  }, [firstRun]);

  const handleSave = (): void => {
    void doSave().then((ok) => {
      // Blocked by key validation: open the API key section so the inline
      // error is visible rather than failing silently behind a collapsed
      // header.
      if (!ok) setOpenSections((prev) => ({ ...prev, apiKey: true }));
    });
  };

  const enabledBands = NOTIFICATION_BAND_KEYS.filter((key) => form.notifications[key]).length;
  const isAccuWeather = form.weatherProvider === 'accuweather';
  const quotaSummary = !isAccuWeather
    ? 'keyless'
    : form.dailyApiQuota === 0
      ? 'no cap'
      : `quota ${form.dailyApiQuota}/day`;

  return (
    <div className="svws-panel" style={S.root}>
      <style>{THEME_STYLE}</style>

      <div style={S.controlBar}>
        <ThemeToggle />
      </div>

      <StatusDashboard
        status={status}
        loading={loading}
        lastUpdatedMs={lastUpdatedMs}
        lastAttemptMs={lastAttemptMs}
        stale={stale}
      />

      {error ? (
        <div role="alert" style={S.errorBanner}>
          Status unavailable ({error}), retrying automatically.
        </div>
      ) : null}

      {/* Shown when the plugin reports not running and the saved configuration
          has no API key: the one situation where the panel knows exactly what
          the next step is. An inline callout, deliberately not a modal; the
          effect above also auto-opens the API key section so the input is one
          glance away. */}
      {firstRun ? (
        <div style={S.callout}>
          <span>
            Add your AccuWeather API key to begin. The plugin stays idle until a key is saved; the
            API key section below has a Test button to verify it first.
          </span>
        </div>
      ) : null}

      <Section
        id="svws-section-apikey"
        title="Weather source"
        open={openSections.apiKey}
        onToggle={() => toggleSection('apiKey')}
        summary={
          form.weatherProvider === 'accuweather'
            ? form.accuWeatherApiKey.trim()
              ? 'AccuWeather (key set)'
              : 'AccuWeather (no key)'
            : 'Open-Meteo (keyless)'
        }
      >
        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="svws-provider">
            Provider
          </label>
          <select
            id="svws-provider"
            style={S.input}
            value={form.weatherProvider}
            onChange={(e) => setField('weatherProvider', e.target.value as WeatherProviderId)}
          >
            {WEATHER_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {WEATHER_PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </div>

        {form.weatherProvider === 'accuweather' ? (
          <ApiKeyField
            value={form.accuWeatherApiKey}
            keyError={keyError}
            onChange={(next) => {
              setField('accuWeatherApiKey', next);
              clearKeyError();
            }}
          />
        ) : (
          <>
            <div style={S.fieldRow}>
              <label style={S.label} htmlFor="svws-ombase">
                Open-Meteo base URL
              </label>
              <input
                id="svws-ombase"
                type="text"
                style={S.input}
                value={form.openMeteoBaseUrl}
                placeholder="https://api.open-meteo.com"
                onChange={(e) => setField('openMeteoBaseUrl', e.target.value)}
              />
            </div>
            <p style={S.help}>
              Weather data by Open-Meteo.com (CC BY 4.0), no API key required. The free public
              service is for non-commercial use; commercial users should self-host the open-source
              Open-Meteo server or use a paid plan and enter its URL above. Leave blank to use the
              public service.
            </p>
          </>
        )}
      </Section>

      <Section
        id="svws-section-cadence"
        title="Fetch and emission cadence"
        open={openSections.cadence}
        onToggle={() => toggleSection('cadence')}
        summary={`every ${form.updateFrequency} min, broadcast ${form.emissionInterval} s, ${quotaSummary}`}
      >
        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="svws-update">
            Weather update frequency
          </label>
          <NumberInput
            id="svws-update"
            value={form.updateFrequency}
            min={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN}
            max={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX}
            units="minutes"
            onChange={(n) => setField('updateFrequency', n)}
          />
        </div>
        <p style={S.help}>
          {isAccuWeather
            ? `Each fetch costs one AccuWeather API call. 30 min uses 48 calls/day, comfortably under the free-tier ${CONFIG_DEFAULTS.DAILY_API_QUOTA}/day cap.`
            : 'How often new weather data is fetched from Open-Meteo. Open-Meteo is keyless with generous limits, so a shorter interval is fine.'}
        </p>

        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="svws-emission">
            Broadcast interval (seconds)
          </label>
          <NumberInput
            id="svws-emission"
            value={form.emissionInterval}
            min={CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN}
            max={CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX}
            units="seconds"
            onChange={(n) => setField('emissionInterval', n)}
          />
        </div>
        <p style={S.help}>
          How often the cached weather payload is re-emitted to the Signal K bus. Independent of the
          AccuWeather fetch cadence.
        </p>

        {isAccuWeather ? (
          <>
            <div style={S.fieldRow}>
              <label style={S.label} htmlFor="svws-quota">
                Daily API call quota
              </label>
              <NumberInput
                id="svws-quota"
                value={form.dailyApiQuota}
                min={CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN}
                max={CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX}
                units="calls per 24h (0 = no cap)"
                onChange={(n) => setField('dailyApiQuota', n)}
              />
            </div>
            <p style={S.help}>
              At {Math.round(QUOTA_WARN_RATIO * 100)}% usage the banner warns; at 100% fetches pause
              until the rolling window drops. Applies to AccuWeather only.
            </p>
          </>
        ) : null}
      </Section>

      <Section
        id="svws-section-notifications"
        title="Severe-weather notifications"
        open={openSections.notifications}
        onToggle={() => toggleSection('notifications')}
        summary={
          form.notifications.enabled
            ? `${enabledBands} of ${NOTIFICATION_BAND_KEYS.length} bands`
            : 'off'
        }
      >
        <NotificationToggles notifications={form.notifications} onChange={setNotification} />
      </Section>

      <FooterBar
        dirty={dirty}
        saving={saving}
        action={action}
        onSave={handleSave}
        onDiscard={discard}
      />
    </div>
  );
}
