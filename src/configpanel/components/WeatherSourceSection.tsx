import type * as React from 'react';
import {
  WEATHER_MODE_IDS,
  WEATHER_MODE_LABELS,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
  type WeatherMode,
  type WeatherProviderId,
} from '../../constants/notifications-shared.js';
import type { PanelFormState } from '../hooks/usePanelConfig.js';
import { S } from '../styles.js';
import ApiKeyField from './ApiKeyField.js';
import CheckboxRow from './CheckboxRow.js';
import MergeProviderList from './MergeProviderList.js';

interface Props {
  form: PanelFormState;
  setField: <K extends keyof PanelFormState>(key: K, value: PanelFormState[K]) => void;
  // Derived view-state from deriveSourceState, computed once at the root. The
  // section reads the merge, key-field, and Open-Meteo flags; single-mode key
  // state stays at the root, which threads it into the source summary.
  merged: boolean;
  hasAccuWeatherKey: boolean;
  showKeyField: boolean;
  openMeteoActive: boolean;
  // Inline key error and its clearer, owned by usePanelConfig.
  keyError: string | null;
  clearKeyError: () => void;
}

/**
 * The Weather-source section body: provider mode, the merged-vs-single
 * provider picker, the AccuWeather key field, the Open-Meteo self-host URL,
 * the Met.no attribution, and the marine toggle. The composition root keeps
 * the collapsible Section wrapper (with its summary); this owns the controls,
 * mirroring how NotificationToggles owns the notifications section internals.
 */
export default function WeatherSourceSection({
  form,
  setField,
  merged,
  hasAccuWeatherKey,
  showKeyField,
  openMeteoActive,
  keyError,
  clearKeyError,
}: Props): React.ReactElement {
  return (
    <>
      <div style={S.fieldRow}>
        <label style={S.label} htmlFor="svws-mode">
          Provider mode
        </label>
        <select
          id="svws-mode"
          style={S.input}
          value={form.weatherMode}
          onChange={(e) => setField('weatherMode', e.target.value as WeatherMode)}
        >
          {WEATHER_MODE_IDS.map((id) => (
            <option key={id} value={id}>
              {WEATHER_MODE_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      {merged ? (
        <>
          <MergeProviderList
            mergeProviders={form.mergeProviders}
            hasAccuWeatherKey={hasAccuWeatherKey}
            onChange={(next) => setField('mergeProviders', next)}
          />
          {/* The fieldset's own note carries the primary meaning; this adds
              only the facts the fieldset omits, so the two are not redundant. */}
          <p style={S.help}>
            Merge blends the current conditions of every included provider onto one merged source.
            AccuWeather joins only once a key is set below.
          </p>
        </>
      ) : (
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
      )}

      {/* The key field is shown whenever it is useful to set a key: single
          mode with AccuWeather picked, or any merged config (so the operator
          can add a key to enable AccuWeather in the blend). */}
      {showKeyField ? (
        <ApiKeyField
          value={form.accuWeatherApiKey}
          keyError={keyError}
          onChange={(next) => {
            setField('accuWeatherApiKey', next);
            clearKeyError();
          }}
        />
      ) : null}

      {/* Open-Meteo base URL: shown when Open-Meteo is the active single
          provider, or when it is one of the merged providers, since the
          self-host URL applies in both. */}
      {openMeteoActive ? (
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
            Weather data by Open-Meteo.com (CC BY 4.0), no API key required. The free public service
            is for non-commercial use; commercial users should self-host the open-source Open-Meteo
            server or use a paid plan and enter its URL above. Leave blank to use the public
            service.
          </p>
        </>
      ) : null}

      {/* Met.no attribution: single mode only, where it is the sole source.
          In merged mode the merge list and its help cover provider details. */}
      {!merged && form.weatherProvider === 'met-no' ? (
        <p style={S.help}>
          Weather data from the Norwegian Meteorological Institute (api.met.no, CC BY 4.0), no API
          key required. Global coverage, with Nordic and European weather alerts.
        </p>
      ) : null}

      <CheckboxRow
        id="svws-marine"
        label="Emit sea state (waves, swell, sea temperature, current)"
        checked={form.marineData}
        onChange={(checked) => setField('marineData', checked)}
      />
      <p style={S.help}>
        Adds a keyless Open-Meteo Marine layer on environment.water.* and environment.current,
        independent of the source above. Coastal and offshore only; inland points have no data.
      </p>
    </>
  );
}
