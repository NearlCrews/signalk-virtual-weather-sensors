import type * as React from 'react';
import { Checkbox, LabeledField, Select, Stack, TextInput } from 'signalk-nearlcrews-ui';
import {
  WEATHER_MODE_IDS,
  WEATHER_MODE_LABELS,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
  type WeatherMode,
  type WeatherProviderId,
} from '../../constants/notifications-shared.js';
import type { PanelFormState } from '../hooks/usePanelConfig.js';
import ApiKeyField from './ApiKeyField.js';
import MergeProviderList from './MergeProviderList.js';

interface Props {
  form: PanelFormState;
  setField: <K extends keyof PanelFormState>(key: K, value: PanelFormState[K]) => void;
  merged: boolean;
  hasAccuWeatherKey: boolean;
  showKeyField: boolean;
  openMeteoActive: boolean;
  keyError: string | null;
  clearKeyError: () => void;
}

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
    <Stack gap={4}>
      <LabeledField label="Provider mode">
        <Select
          id="svws-mode"
          value={form.weatherMode}
          onChange={(event) => setField('weatherMode', event.target.value as WeatherMode)}
        >
          {WEATHER_MODE_IDS.map((id) => (
            <option key={id} value={id}>
              {WEATHER_MODE_LABELS[id]}
            </option>
          ))}
        </Select>
      </LabeledField>

      {merged ? (
        <MergeProviderList
          mergeProviders={form.mergeProviders}
          hasAccuWeatherKey={hasAccuWeatherKey}
          onChange={(next) => setField('mergeProviders', next)}
        />
      ) : (
        <LabeledField label="Provider">
          <Select
            id="svws-provider"
            value={form.weatherProvider}
            onChange={(event) =>
              setField('weatherProvider', event.target.value as WeatherProviderId)
            }
          >
            {WEATHER_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {WEATHER_PROVIDER_LABELS[id]}
              </option>
            ))}
          </Select>
        </LabeledField>
      )}

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

      {openMeteoActive ? (
        <LabeledField
          label="Open-Meteo base URL"
          description="Weather data by Open-Meteo.com (CC BY 4.0), no API key required. Leave blank to use the public non-commercial service. Commercial users can enter a self-hosted or paid-service URL."
        >
          <TextInput
            id="svws-ombase"
            value={form.openMeteoBaseUrl}
            placeholder="https://api.open-meteo.com"
            onChange={(event) => setField('openMeteoBaseUrl', event.target.value)}
          />
        </LabeledField>
      ) : null}

      {!merged && form.weatherProvider === 'met-no' ? (
        <p>
          Weather data from the Norwegian Meteorological Institute (api.met.no, CC BY 4.0), no API
          key required. Global coverage includes Nordic and European weather alerts.
        </p>
      ) : null}

      <Checkbox
        id="svws-marine"
        label="Emit sea state"
        description="Adds waves, swell, sea temperature, and current from the keyless Open-Meteo Marine layer. Coastal and offshore only; inland points have no data."
        checked={form.marineData}
        onChange={(event) => setField('marineData', event.target.checked)}
      />
    </Stack>
  );
}
