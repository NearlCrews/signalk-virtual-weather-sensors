import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionBar,
  Banner,
  Button,
  Cluster,
  CollapsibleSection,
  PanelRoot,
  Stack,
  supportsNativeCssScope,
  ThemeToggle,
} from 'signalk-nearlcrews-ui';
import {
  CONFIG_DEFAULTS,
  NOTIFICATION_BAND_KEYS,
  providerRequiresApiKey,
  QUOTA_WARN_RATIO,
} from '../constants/notifications-shared.js';
import IntegerField from './components/IntegerField.js';
import NotificationToggles from './components/NotificationToggles.js';
import StatusDashboard from './components/StatusDashboard.js';
import WeatherSourceSection from './components/WeatherSourceSection.js';
import { usePanelConfig } from './hooks/usePanelConfig.js';
import { useStatus } from './hooks/useStatus.js';
import styles from './PluginConfigurationPanel.module.css';
import { deriveSourceState } from './sourceState.js';

interface Props {
  configuration: unknown;
  save: (configuration: unknown) => unknown;
}

type SectionKey = 'apiKey' | 'cadence' | 'notifications';

export default function PluginConfigurationPanel(props: Props): React.ReactElement {
  if (typeof window === 'undefined' || !supportsNativeCssScope(window)) {
    return (
      <div className={styles.compatibility} data-browser-compatibility-message="" role="alert">
        <h2>Browser update required</h2>
        <p>
          This panel requires native CSS @scope. Update the browser or embedded WebView before
          reopening Signal K Admin.
        </p>
      </div>
    );
  }

  return <SupportedPluginConfigurationPanel {...props} />;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This composition root coordinates independent panel sections and their save state.
function SupportedPluginConfigurationPanel({ configuration, save }: Props): React.ReactElement {
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

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    apiKey: false,
    cadence: false,
    notifications: false,
  });
  const [invalidIntegerIds, setInvalidIntegerIds] = useState<Set<string>>(() => new Set());
  const [integerResetKey, setIntegerResetKey] = useState(0);
  const actionStatusRef = useRef<HTMLDivElement>(null);

  const setIntegerValidity = useCallback((id: string, valid: boolean): void => {
    setInvalidIntegerIds((previous) => {
      const currentlyInvalid = previous.has(id);
      if (currentlyInvalid === !valid) return previous;
      const next = new Set(previous);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const requiresKey = providerRequiresApiKey(savedForm.weatherProvider);
  const firstRun =
    status !== null && !status.running && requiresKey && savedForm.accuWeatherApiKey.trim() === '';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (firstRun && !autoOpened.current) {
      autoOpened.current = true;
      setOpenSections((previous) => ({ ...previous, apiKey: true }));
    }
  }, [firstRun]);

  const handleSave = (): void => {
    const firstInvalidId = invalidIntegerIds.values().next().value;
    if (typeof firstInvalidId === 'string') {
      setOpenSections((previous) => ({ ...previous, cadence: true }));
      requestAnimationFrame(() => document.getElementById(firstInvalidId)?.focus());
      return;
    }

    const saveResult = doSave();
    requestAnimationFrame(() => actionStatusRef.current?.focus());
    void saveResult.then((ok) => {
      if (!ok) {
        setOpenSections((previous) => ({ ...previous, apiKey: true }));
        requestAnimationFrame(() => document.getElementById('svws-apikey')?.focus());
      }
    });
  };

  const handleDiscard = (): void => {
    discard();
    setInvalidIntegerIds(new Set());
    setIntegerResetKey((value) => value + 1);
    requestAnimationFrame(() => actionStatusRef.current?.focus());
  };

  const enabledBands = NOTIFICATION_BAND_KEYS.filter((key) => form.notifications[key]).length;
  const src = deriveSourceState(form);
  const unconfigured = configuration == null;
  const hasInvalidInteger = invalidIntegerIds.size > 0;
  const actionStatus = action?.message
    ? action.message
    : hasInvalidInteger
      ? 'Correct the invalid cadence value before saving.'
      : dirty
        ? 'Unsaved changes.'
        : unconfigured
          ? 'Save to enable the plugin.'
          : 'Configuration is up to date.';
  const actionStatusClass =
    action?.isError || hasInvalidInteger ? styles.actionError : styles.actionStatus;

  return (
    <PanelRoot legacyThemeStorageKeys={['svws-theme']} width="wide">
      <Stack gap={4}>
        <Cluster justify="end">
          <ThemeToggle />
        </Cluster>

        <StatusDashboard
          status={status}
          loading={loading}
          lastUpdatedMs={lastUpdatedMs}
          lastAttemptMs={lastAttemptMs}
          stale={stale}
        />

        {error ? (
          <Banner live="polite" tone="danger" title="Status unavailable">
            {error}. Retrying automatically.
          </Banner>
        ) : null}

        {firstRun ? (
          <Banner tone="info" title="AccuWeather setup required">
            Add your AccuWeather API key to begin. The plugin stays idle until a key is saved. Use
            the Test button in Weather source to verify it first.
          </Banner>
        ) : null}

        <CollapsibleSection
          id="svws-section-apikey"
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
            clearKeyError={clearKeyError}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="svws-section-cadence"
          title="Fetch and emission cadence"
          open={openSections.cadence}
          onOpenChange={(open) => setOpenSections((previous) => ({ ...previous, cadence: open }))}
          summary={`every ${form.updateFrequency} min, broadcast ${form.emissionInterval} s, ${src.quotaSummary}`}
          summaryPlacement="header"
          mountStrategy="retain"
        >
          <Stack gap={4}>
            <IntegerField
              key={`update-${integerResetKey}`}
              id="svws-update"
              label="Weather update frequency"
              value={form.updateFrequency}
              min={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN}
              max={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX}
              units="minutes"
              onChange={(value) => setField('updateFrequency', value)}
              onValidityChange={setIntegerValidity}
              description={
                src.accuWeatherInPlay
                  ? `Each fetch costs one AccuWeather API call. 30 minutes uses 48 calls per day, within the default ${CONFIG_DEFAULTS.DAILY_API_QUOTA} call quota.`
                  : 'How often new weather data is fetched. The keyless providers have generous limits, so a shorter interval is fine.'
              }
            />

            <IntegerField
              key={`emission-${integerResetKey}`}
              id="svws-emission"
              label="Broadcast interval"
              value={form.emissionInterval}
              min={CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN}
              max={CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX}
              units="seconds"
              onChange={(value) => setField('emissionInterval', value)}
              onValidityChange={setIntegerValidity}
              description="How often the cached weather payload is re-emitted to the Signal K bus. This is independent of the weather fetch cadence."
            />

            {src.accuWeatherInPlay ? (
              <IntegerField
                key={`quota-${integerResetKey}`}
                id="svws-quota"
                label="Daily API call quota"
                value={form.dailyApiQuota}
                min={CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN}
                max={CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX}
                units="calls per 24 hours"
                onChange={(value) => setField('dailyApiQuota', value)}
                onValidityChange={setIntegerValidity}
                description={`At ${Math.round(QUOTA_WARN_RATIO * 100)}% usage the panel warns. At 100%, fetches pause until the rolling window drops. Set 0 for no cap. Applies to AccuWeather only.`}
              />
            ) : null}
          </Stack>
        </CollapsibleSection>

        <CollapsibleSection
          id="svws-section-notifications"
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

        <ActionBar
          data-panel-action-bar=""
          sticky
          statusRef={actionStatusRef}
          status={
            <span className={actionStatusClass} role="status">
              {actionStatus}
            </span>
          }
          actions={
            <>
              <Button
                variant="primary"
                aria-label="Save configuration"
                loading={saving}
                loadingLabel="Saving"
                disabled={saving || (!dirty && !unconfigured && !hasInvalidInteger)}
                onClick={handleSave}
              >
                Save
              </Button>
              <Button
                aria-label="Discard changes"
                disabled={saving || (!dirty && !hasInvalidInteger)}
                onClick={handleDiscard}
              >
                Discard
              </Button>
            </>
          }
        />
      </Stack>
    </PanelRoot>
  );
}
