import { useCallback, useState } from 'react';
// Shared with the TS plugin runtime so the federated panel and the rjsf
// schema cannot drift on label wording, numeric defaults, or key validation
// bounds.
import {
  CONFIG_DEFAULTS,
  DEFAULT_MERGE_PROVIDERS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_WEATHER_MODE,
  DEFAULT_WEATHER_PROVIDER,
  providerRequiresApiKey,
  validateKeyLength,
  type WeatherMode,
  type WeatherProviderId,
} from '../../constants/notifications-shared.js';
import type {
  NotificationsConfig,
  PanelStatusResponse,
  PluginConfiguration,
} from '../../types/index.js';
import { toErrorText } from '../api-base.js';

/** Strip the readonly markers so form state can be edited field by field. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// Form shapes derive from the runtime config types: a new config field shows
// up here as a compile error instead of a silently missing form field.
export type NotificationsFormState = Mutable<NotificationsConfig>;

export type PanelFormState = Omit<Mutable<PluginConfiguration>, 'notifications'> & {
  notifications: NotificationsFormState;
};

export interface SaveAction {
  message: string;
  isError: boolean;
}

/**
 * Derive form field values from a (possibly partial) saved config, filling
 * defaults from the shared module. Single source for the initial state and
 * the resync path so a new field is added in one place, not two.
 */
function formStateFromConfig(c: unknown): PanelFormState {
  const cfg = (c ?? {}) as {
    weatherProvider?: WeatherProviderId;
    weatherMode?: WeatherMode;
    mergeProviders?: ReadonlyArray<WeatherProviderId>;
    accuWeatherApiKey?: string;
    openMeteoBaseUrl?: string;
    marineData?: boolean;
    updateFrequency?: number;
    emissionInterval?: number;
    dailyApiQuota?: number;
    notifications?: Partial<NotificationsFormState>;
  };
  return {
    weatherProvider: cfg.weatherProvider ?? DEFAULT_WEATHER_PROVIDER,
    weatherMode: cfg.weatherMode ?? DEFAULT_WEATHER_MODE,
    mergeProviders: cfg.mergeProviders ?? DEFAULT_MERGE_PROVIDERS,
    accuWeatherApiKey: cfg.accuWeatherApiKey ?? '',
    openMeteoBaseUrl: cfg.openMeteoBaseUrl ?? '',
    marineData: cfg.marineData ?? false,
    updateFrequency: cfg.updateFrequency ?? CONFIG_DEFAULTS.UPDATE_FREQUENCY,
    emissionInterval: cfg.emissionInterval ?? CONFIG_DEFAULTS.EMISSION_INTERVAL,
    dailyApiQuota: cfg.dailyApiQuota ?? CONFIG_DEFAULTS.DAILY_API_QUOTA,
    notifications: { ...DEFAULT_NOTIFICATIONS, ...(cfg.notifications ?? {}) },
  };
}

// Field-by-field deep compare. The form is a fixed, shallow shape, so an
// explicit compare is cheaper and clearer than JSON.stringify and immune to
// key-order drift.
function formsEqual(a: PanelFormState, b: PanelFormState): boolean {
  return (
    a.weatherProvider === b.weatherProvider &&
    a.weatherMode === b.weatherMode &&
    a.mergeProviders.length === b.mergeProviders.length &&
    a.mergeProviders.every((id, i) => id === b.mergeProviders[i]) &&
    a.accuWeatherApiKey === b.accuWeatherApiKey &&
    a.openMeteoBaseUrl === b.openMeteoBaseUrl &&
    a.marineData === b.marineData &&
    a.updateFrequency === b.updateFrequency &&
    a.emissionInterval === b.emissionInterval &&
    a.dailyApiQuota === b.dailyApiQuota &&
    a.notifications.enabled === b.notifications.enabled &&
    a.notifications.wind === b.notifications.wind &&
    a.notifications.visibility === b.notifications.visibility &&
    a.notifications.heat === b.notifications.heat &&
    a.notifications.cold === b.notifications.cold &&
    a.notifications.weather === b.notifications.weather
  );
}

// Post-save restart confirmation cadence: up to 4 polls, 1.5 s apart, before
// giving up. Named like useStatus's POLL_MS so the numbers read as policy.
const RESTART_POLL_ATTEMPTS = 4;
const RESTART_POLL_DELAY_MS = 1500;

// The plugin is restarting after a save, so /api/status may be briefly
// unreachable: poll a few times before giving up, then report what the
// status actually says rather than an optimistic "Saved." that could lie.
async function confirmRestart(
  refreshStatus: () => Promise<PanelStatusResponse | null>
): Promise<SaveAction> {
  let data: PanelStatusResponse | null = null;
  for (let attempt = 0; attempt < RESTART_POLL_ATTEMPTS && !data; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, RESTART_POLL_DELAY_MS));
    data = await refreshStatus();
  }
  if (!data) {
    // Never reached a readable status: report honestly rather than claiming
    // success.
    return {
      message: 'Saved, but could not confirm the plugin restarted. Check the plugin status.',
      isError: true,
    };
  }
  return {
    message: data.running
      ? 'Saved. Plugin restarted with the new configuration.'
      : `Saved, but the plugin did not come back online: ${data.banner || 'unknown'}.`,
    isError: !data.running,
  };
}

export interface UsePanelConfigResult {
  form: PanelFormState;
  savedForm: PanelFormState;
  dirty: boolean;
  saving: boolean;
  // Save outcome for the footer status line; null until the first save.
  action: SaveAction | null;
  // Inline blocker shown by ApiKeyField when Save rejects a too-short key.
  keyError: string | null;
  setField: <K extends keyof PanelFormState>(key: K, value: PanelFormState[K]) => void;
  setNotification: (key: keyof NotificationsFormState, value: boolean) => void;
  discard: () => void;
  clearKeyError: () => void;
  // Resolves false when save was blocked by key validation (the caller opens
  // the API key section so the inline error is visible), true otherwise.
  doSave: () => Promise<boolean>;
}

/**
 * Form state, dirty tracking, and the save flow for the config panel.
 *
 * The save flow preserves the semantics the panel has always had: the host's
 * save() may be sync OR return a Promise, and SK admin save() typically
 * resolves with no value regardless of server-side outcome, so success is
 * confirmed by polling /api/status (via `refreshStatus`) until the plugin
 * reports it came back running. Never fire-and-forget.
 */
export function usePanelConfig(
  configuration: unknown,
  hostSave: (config: unknown) => unknown,
  refreshStatus: () => Promise<PanelStatusResponse | null>
): UsePanelConfigResult {
  const [form, setForm] = useState<PanelFormState>(() => formStateFromConfig(configuration));
  // Last configuration the host persisted, in form shape: the dirty baseline
  // and the Discard target. Starts as the same object the form starts from.
  const [savedForm, setSavedForm] = useState<PanelFormState>(form);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<SaveAction | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Resync when the host supplies a new configuration object (e.g. after a
  // save and restart), using the render-time previous-props pattern: React
  // re-runs this component immediately after the setState calls, before any
  // child renders. A clean form adopts the new config wholesale; a dirty form
  // keeps the user's unsaved edits and only moves the baseline.
  const [prevConfiguration, setPrevConfiguration] = useState(configuration);
  if (prevConfiguration !== configuration) {
    setPrevConfiguration(configuration);
    const next = formStateFromConfig(configuration);
    if (formsEqual(form, savedForm)) setForm(next);
    setSavedForm(next);
  }

  const setField = useCallback(
    <K extends keyof PanelFormState>(key: K, value: PanelFormState[K]): void => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setNotification = useCallback((key: keyof NotificationsFormState, value: boolean): void => {
    setForm((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  }, []);

  const discard = useCallback((): void => {
    setForm(savedForm);
    setKeyError(null);
    setAction(null);
  }, [savedForm]);

  const clearKeyError = useCallback((): void => setKeyError(null), []);

  const doSave = useCallback(async (): Promise<boolean> => {
    const trimmedKey = form.accuWeatherApiKey.trim();
    // The key is only required (and only validated) when the active provider
    // requires one. Under the keyless Open-Meteo default the field is hidden
    // and usually empty, so gating Save on key length there would block every
    // fresh install. This matches the rjsf schema, which no longer declares a
    // minLength on the now-optional key.
    if (providerRequiresApiKey(form.weatherProvider)) {
      const keyLengthError = validateKeyLength(trimmedKey);
      if (keyLengthError) {
        setKeyError(keyLengthError);
        return false;
      }
    }
    setKeyError(null);
    setSaving(true);
    setAction({ message: 'Saving...', isError: false });
    try {
      const payload: PanelFormState = {
        ...form,
        accuWeatherApiKey: trimmedKey,
        openMeteoBaseUrl: form.openMeteoBaseUrl.trim(),
        notifications: { ...form.notifications },
      };
      await Promise.resolve(hostSave(payload));
      // What we handed the host is the new baseline; adopting it as the form
      // too keeps dirty false even when trimming changed the key. Adopt only
      // if the user has not typed since Save was clicked: a mid-save edit
      // must survive and stay dirty against the new baseline.
      setForm((current) => (formsEqual(current, form) ? payload : current));
      setSavedForm(payload);
      setAction(await confirmRestart(refreshStatus));
    } catch (err) {
      setAction({
        message: `Save failed: ${toErrorText(err)}`,
        isError: true,
      });
    } finally {
      setSaving(false);
    }
    return true;
  }, [form, hostSave, refreshStatus]);

  return {
    form,
    savedForm,
    dirty: !formsEqual(form, savedForm),
    saving,
    action,
    keyError,
    setField,
    setNotification,
    discard,
    clearKeyError,
    doSave,
  };
}
