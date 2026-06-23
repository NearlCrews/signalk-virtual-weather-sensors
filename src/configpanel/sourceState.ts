// Pure derivation of the Weather-source section's view state from the form.
//
// The panel's source section, the cadence section, and the source summary all
// depend on a handful of booleans and strings computed from the same few form
// fields (the mode, the single provider, the merge list, and the key). Keeping
// the derivation in one pure function does two things: it gives the composition
// root a single `deriveSourceState(form)` call instead of eight inline
// derivations (which tripped the cognitive-complexity gate), and it keeps the
// merged-vs-single branching in one place where it can be read and tested as a
// unit.

import {
  providerRequiresApiKey,
  WEATHER_PROVIDER_LABELS,
} from '../constants/notifications-shared.js';
import type { PanelFormState } from './hooks/usePanelConfig.js';

export interface SourceState {
  // True when the panel is in merged mode (blends several providers).
  merged: boolean;
  // True when a non-empty AccuWeather key is in the form.
  hasAccuWeatherKey: boolean;
  // True when the single-provider pick requires a key (AccuWeather).
  singleNeedsKey: boolean;
  // True when AccuWeather is actually fetching: the single keyed provider, or
  // a member of the merge list. Drives the cadence section's quota field and
  // AccuWeather-specific help.
  accuWeatherInPlay: boolean;
  // True when the key field should be shown: single mode with a keyed provider,
  // or any merged config (so a key can be added to enable AccuWeather).
  showKeyField: boolean;
  // True when Open-Meteo fetches: the single Open-Meteo provider, or a member
  // of the merge list. Drives the self-host base-URL field.
  openMeteoActive: boolean;
  // Short cadence-summary fragment describing the quota posture.
  quotaSummary: string;
  // Collapsed-section summary for the Weather-source header.
  sourceSummary: string;
}

/**
 * Derive every view-state value the Weather-source and cadence sections need
 * from the current form. Pure: no React, no side effects, same input gives the
 * same output.
 */
export function deriveSourceState(form: PanelFormState): SourceState {
  const merged = form.weatherMode === 'merged';
  const hasAccuWeatherKey = form.accuWeatherApiKey.trim() !== '';
  // The single-provider picker drives whether a key is required in single
  // mode; in merged mode the key is optional (it gates AccuWeather joining the
  // blend), but the cadence section's quota and AccuWeather-specific help still
  // key off whether AccuWeather is actually in play.
  const singleNeedsKey = providerRequiresApiKey(form.weatherProvider);
  // In merged mode AccuWeather is in play when any included provider needs a
  // key; the shared predicate is the single source for that, so the merge list
  // and this derivation cannot drift on which providers are keyed.
  const accuWeatherInPlay = merged
    ? form.mergeProviders.some(providerRequiresApiKey)
    : singleNeedsKey;
  // The key field is shown when single mode picks a keyed provider, or in
  // merged mode regardless, so the operator can add a key to enable
  // AccuWeather in the blend.
  const showKeyField = merged || singleNeedsKey;
  // Open-Meteo's self-host base URL applies whenever Open-Meteo fetches: as
  // the single provider, or as one of the merged providers.
  const openMeteoActive = merged
    ? form.mergeProviders.includes('open-meteo')
    : form.weatherProvider === 'open-meteo';
  const quotaSummary = !accuWeatherInPlay
    ? 'keyless'
    : form.dailyApiQuota === 0
      ? 'no cap'
      : `quota ${form.dailyApiQuota}/day`;

  // Source-section summary: in merged mode, the merge count and the primary;
  // in single mode, the provider label plus its key state when keyed. The
  // primary id stays local: callers only need the finished summary string.
  const primaryId = form.mergeProviders[0];
  const sourceSummary = merged
    ? `merge of ${form.mergeProviders.length}, primary ${
        primaryId ? WEATHER_PROVIDER_LABELS[primaryId] : 'none'
      }`
    : singleNeedsKey
      ? `${WEATHER_PROVIDER_LABELS[form.weatherProvider]}${hasAccuWeatherKey ? ' (key set)' : ' (no key)'}`
      : WEATHER_PROVIDER_LABELS[form.weatherProvider];

  return {
    merged,
    hasAccuWeatherKey,
    singleNeedsKey,
    accuWeatherInPlay,
    showKeyField,
    openMeteoActive,
    quotaSummary,
    sourceSummary,
  };
}
