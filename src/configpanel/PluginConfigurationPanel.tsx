import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Banner,
  CollapsibleSection,
  NumberField,
  PanelShell,
  Stack,
  useUnsavedChangesGuard,
} from 'signalk-nearlcrews-ui';
import { SaveActionBar } from 'signalk-nearlcrews-ui/composites';
import {
  ACCUWEATHER_FETCH_COST_NOTE,
  CONFIG_DEFAULTS,
  NOTIFICATION_BAND_KEYS,
  QUOTA_WARN_RATIO,
  selectionRequiresApiKey,
} from '../constants/notifications-shared.js';
import NotificationToggles from './components/NotificationToggles.js';
import StatusDashboard from './components/StatusDashboard.js';
import WeatherSourceSection from './components/WeatherSourceSection.js';
import { type SaveBlocker, usePanelConfig } from './hooks/usePanelConfig.js';
import { useStatus } from './hooks/useStatus.js';
import { deriveSourceState } from './sourceState.js';

interface Props {
  configuration: unknown;
  save: (configuration: unknown) => void;
}

type SectionKey = 'apiKey' | 'cadence' | 'notifications';

/** Cadence fields whose live validation blocks Save while a draft is invalid. */
type CadenceField = 'updateFrequency' | 'emissionInterval' | 'dailyApiQuota';

/** Heading of the cadence section, named once so the Save bar cannot point at a heading that no longer exists. */
const CADENCE_SECTION_TITLE = 'Fetch and emission cadence';

const INVALID_CADENCE_MESSAGE = `Correct the invalid value under ${CADENCE_SECTION_TITLE} before saving.`;

// Signal K Admin's save callback returns before persistence settles, so the
// busy state covers the status poll that follows the request, not a write the
// panel can observe. Kept to one short clause: SaveActionBar reuses
// `labels.saving` as the Save button's accessible description while busy, and
// a two-sentence description is a poor thing to hear on a button.
const SAVING_MESSAGE = 'Checking the current plugin status…';

export default function PluginConfigurationPanel(props: Props): React.ReactElement {
  return (
    <PanelShell width="wide" themeToggle="end">
      <WeatherPanel {...props} />
    </PanelShell>
  );
}

function WeatherPanel({ configuration, save }: Props): React.ReactElement {
  const { status, error, lastUpdatedMs, stale, loading, refresh } = useStatus();
  const {
    form,
    requestedForm,
    dirty,
    saving,
    action,
    saveRequestedAt,
    keyError,
    baseUrlError,
    setField,
    setNotification,
    discard,
    clearKeyError,
    clearBaseUrlError,
    doSave,
  } = usePanelConfig(configuration, save, refresh);

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    apiKey: false,
    cadence: false,
    notifications: false,
  });
  const [invalidCadenceFields, setInvalidCadenceFields] = useState<ReadonlySet<CadenceField>>(
    () => new Set()
  );
  const [cadenceResetKey, setCadenceResetKey] = useState(0);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const baseUrlRef = useRef<HTMLInputElement>(null);

  const setCadenceValidity = useCallback((field: CadenceField, valid: boolean): void => {
    setInvalidCadenceFields((previous) => {
      if (previous.has(field) === !valid) return previous;
      const next = new Set(previous);
      if (valid) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  useUnsavedChangesGuard(dirty);

  const requiresKey = selectionRequiresApiKey(
    requestedForm.weatherMode,
    requestedForm.weatherProvider,
    requestedForm.mergeProviders
  );
  const firstRun =
    status !== null &&
    !status.running &&
    requiresKey &&
    requestedForm.accuWeatherApiKey.trim() === '';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (firstRun && !autoOpened.current) {
      autoOpened.current = true;
      setOpenSections((previous) => ({ ...previous, apiKey: true }));
    }
  }, [firstRun]);

  const src = deriveSourceState(form);

  // Only a field the panel is actually rendering can block Save. The quota
  // field shows while AccuWeather is in play and NumberField reports validity
  // on transitions, never from an unmount, so an invalid draft the operator can
  // no longer see would otherwise keep Save blocked from off screen. Derived
  // from what is on screen rather than reconciled by an effect, so a future
  // conditionally-rendered cadence field needs no matching release.
  const saveBlockedOnCadence = [...invalidCadenceFields].some(
    (field) => field !== 'dailyApiQuota' || src.accuWeatherInPlay
  );

  const handleSave = (): void => {
    void doSave().then((blocker) => {
      if (blocker === null) return;
      // The refs are stable; the lookup is built here rather than per render
      // because the save-failure branch is its only reader.
      const blockerRefs: Record<SaveBlocker, React.RefObject<HTMLInputElement | null>> = {
        apiKey: apiKeyRef,
        baseUrl: baseUrlRef,
      };
      setOpenSections((previous) => ({ ...previous, apiKey: true }));
      requestAnimationFrame(() => blockerRefs[blocker].current?.focus());
    });
  };

  const handleDiscard = (): void => {
    discard();
    // The reset key drops every cadence draft, and the set is cleared here as
    // well because a field inside a collapsed section reports its validity
    // only once that section is open again.
    setInvalidCadenceFields(new Set());
    setCadenceResetKey((value) => value + 1);
  };

  const enabledBands = NOTIFICATION_BAND_KEYS.filter((key) => form.notifications[key]).length;

  return (
    <>
      <StatusDashboard
        status={status}
        loading={loading}
        lastUpdatedMs={lastUpdatedMs}
        stale={stale}
      />

      {error ? (
        <Banner live="polite" tone="danger" title="Status unavailable">
          {error}. Retrying automatically.
        </Banner>
      ) : null}

      {firstRun ? (
        <Banner tone="info" title="AccuWeather setup required">
          Add your AccuWeather API key to begin. The plugin stays idle until a key is saved. Use the
          Test button in Weather source to verify it first.
        </Banner>
      ) : null}

      <CollapsibleSection
        title="Weather source"
        open={openSections.apiKey}
        onOpenChange={(open) => setOpenSections((previous) => ({ ...previous, apiKey: open }))}
        summary={src.sourceSummary}
        summaryPlacement="header"
        mountStrategy="retain"
      >
        <WeatherSourceSection
          form={form}
          setField={setField}
          merged={src.merged}
          hasAccuWeatherKey={src.hasAccuWeatherKey}
          showKeyField={src.showKeyField}
          openMeteoActive={src.openMeteoActive}
          keyError={keyError}
          baseUrlError={baseUrlError}
          apiKeyRef={apiKeyRef}
          baseUrlRef={baseUrlRef}
          clearKeyError={clearKeyError}
          clearBaseUrlError={clearBaseUrlError}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={CADENCE_SECTION_TITLE}
        open={openSections.cadence}
        onOpenChange={(open) => setOpenSections((previous) => ({ ...previous, cadence: open }))}
        summary={`every ${form.updateFrequency} min, broadcast ${form.emissionInterval} s, ${src.quotaSummary}`}
        summaryPlacement="header"
        mountStrategy="retain"
      >
        <Stack gap={4}>
          <NumberField
            label="Weather update frequency"
            unit="minutes"
            integer
            min={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN}
            max={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX}
            value={form.updateFrequency}
            onValueChange={(value) => setField('updateFrequency', value)}
            onValidityChange={(valid) => setCadenceValidity('updateFrequency', valid)}
            resetKey={cadenceResetKey}
            errorLive="polite"
            description={
              src.accuWeatherInPlay
                ? `${ACCUWEATHER_FETCH_COST_NOTE} 30 minutes costs at most 49 calls per day at a fixed position, within the default ${CONFIG_DEFAULTS.DAILY_API_QUOTA} call quota. Underway it costs up to 96, which exceeds that quota.`
                : 'How often new weather data is fetched. The keyless providers have generous limits, so a shorter interval is fine.'
            }
          />

          <NumberField
            label="Broadcast interval"
            unit="seconds"
            integer
            min={CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN}
            max={CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX}
            value={form.emissionInterval}
            onValueChange={(value) => setField('emissionInterval', value)}
            onValidityChange={(valid) => setCadenceValidity('emissionInterval', valid)}
            resetKey={cadenceResetKey}
            errorLive="polite"
            description="How often the cached weather payload is re-emitted to the Signal K bus. This is independent of the weather fetch cadence."
          />

          {src.accuWeatherInPlay ? (
            <NumberField
              label="Daily API call quota"
              unit="calls per 24 hours"
              integer
              min={CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN}
              max={CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX}
              value={form.dailyApiQuota}
              onValueChange={(value) => setField('dailyApiQuota', value)}
              onValidityChange={(valid) => setCadenceValidity('dailyApiQuota', valid)}
              resetKey={cadenceResetKey}
              errorLive="polite"
              description={`At ${Math.round(QUOTA_WARN_RATIO * 100)}% usage the panel warns. At 100%, fetches pause until the rolling window drops. Set 0 for no cap. Applies to AccuWeather only.`}
            />
          ) : null}
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection
        title="Severe-weather notifications"
        open={openSections.notifications}
        onOpenChange={(open) =>
          setOpenSections((previous) => ({ ...previous, notifications: open }))
        }
        summary={
          form.notifications.enabled
            ? `${enabledBands} of ${NOTIFICATION_BAND_KEYS.length} bands`
            : 'off'
        }
        summaryPlacement="header"
        mountStrategy="retain"
      >
        <NotificationToggles notifications={form.notifications} onChange={setNotification} />
      </CollapsibleSection>

      {action !== null && !action.requested ? (
        <Banner live="polite" tone="danger" title="Save request failed">
          {action.message}
        </Banner>
      ) : null}

      <SaveActionBar
        data-panel-action-bar=""
        dirty={dirty}
        saving={saving}
        unconfigured={configuration == null}
        saveRequestedAt={saveRequestedAt}
        invalidMessage={saveBlockedOnCadence ? INVALID_CADENCE_MESSAGE : null}
        // The bar's own 2,500 ms window would close before the status poll
        // that follows a save request settles, so the panel keeps the window
        // and takes the message down on the next edit, which is the same
        // instant that clears `saveRequestedAt`. An empty string reads as
        // absent, so the bar's own wording covers the wait.
        savedMessageDurationMs={0}
        labels={{ saved: action?.requested ? action.message : '', saving: SAVING_MESSAGE }}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </>
  );
}
