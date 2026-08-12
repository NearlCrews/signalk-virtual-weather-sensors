import { useCallback, useRef, useState } from 'react';
// Shared with the TS plugin runtime so the federated panel and the rjsf
// schema cannot drift on label wording, numeric defaults, or key validation
// bounds.
import {
  CONFIG_DEFAULTS,
  DEFAULT_NOTIFICATIONS,
  providerRequiresApiKey,
  resolveMergeProviders,
  resolveWeatherMode,
  resolveWeatherProvider,
  selectionRequiresApiKey,
  validateApiKeyCandidate,
  validateOpenMeteoBaseUrlCandidate,
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

export type SaveBlockerId = 'svws-apikey' | 'svws-ombase';

interface SaveAction {
  message: string;
  isError: boolean;
}

function openRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Derive form field values from a (possibly partial) saved config, filling
 * defaults from the shared module. Single source for the initial state and
 * the resync path so a new field is added in one place, not two.
 */
export function formStateFromConfig(c: unknown): PanelFormState {
  const cfg = openRecord(c);
  const accuWeatherApiKey = typeof cfg.accuWeatherApiKey === 'string' ? cfg.accuWeatherApiKey : '';
  const weatherProvider = resolveWeatherProvider(
    cfg.weatherProvider,
    accuWeatherApiKey.trim().length > 0
  );
  const weatherMode = resolveWeatherMode(cfg.weatherMode);
  const notifications =
    typeof cfg.notifications === 'object' &&
    cfg.notifications !== null &&
    !Array.isArray(cfg.notifications)
      ? (cfg.notifications as Record<string, unknown>)
      : {};
  const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  return {
    weatherProvider,
    weatherMode,
    mergeProviders: resolveMergeProviders(cfg.mergeProviders, weatherProvider),
    accuWeatherApiKey,
    openMeteoBaseUrl: typeof cfg.openMeteoBaseUrl === 'string' ? cfg.openMeteoBaseUrl : '',
    marineData: bool(cfg.marineData, false),
    updateFrequency: boundedNumber(
      cfg.updateFrequency,
      CONFIG_DEFAULTS.UPDATE_FREQUENCY,
      CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN,
      CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX
    ),
    emissionInterval: boundedNumber(
      cfg.emissionInterval,
      CONFIG_DEFAULTS.EMISSION_INTERVAL,
      CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN,
      CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX
    ),
    dailyApiQuota: boundedNumber(
      cfg.dailyApiQuota,
      CONFIG_DEFAULTS.DAILY_API_QUOTA,
      CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN,
      CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX
    ),
    notifications: {
      enabled: bool(notifications.enabled, DEFAULT_NOTIFICATIONS.enabled),
      wind: bool(notifications.wind, DEFAULT_NOTIFICATIONS.wind),
      visibility: bool(notifications.visibility, DEFAULT_NOTIFICATIONS.visibility),
      heat: bool(notifications.heat, DEFAULT_NOTIFICATIONS.heat),
      cold: bool(notifications.cold, DEFAULT_NOTIFICATIONS.cold),
      weather: bool(notifications.weather, DEFAULT_NOTIFICATIONS.weather),
    },
  };
}

/** Preserve settings that this panel does not understand when saving edits. */
export function configurationFromForm(
  form: PanelFormState,
  originalConfiguration: unknown,
  baselineForm: PanelFormState = formStateFromConfig(originalConfiguration)
): Record<string, unknown> {
  const original = openRecord(originalConfiguration);
  const result: Record<string, unknown> = { ...original };

  // An older panel may normalize a future enum value or a newly expanded
  // numeric range for display. Retain the raw field unless the operator
  // actually changed that control. Missing fields still receive defaults.
  for (const key of [
    'weatherProvider',
    'weatherMode',
    'accuWeatherApiKey',
    'openMeteoBaseUrl',
    'marineData',
    'updateFrequency',
    'emissionInterval',
    'dailyApiQuota',
  ] as const) {
    if (!Object.hasOwn(original, key) || form[key] !== baselineForm[key]) {
      result[key] = form[key];
    }
  }
  const mergeProvidersUnchanged =
    form.mergeProviders.length === baselineForm.mergeProviders.length &&
    form.mergeProviders.every((provider, index) => provider === baselineForm.mergeProviders[index]);
  if (!Object.hasOwn(original, 'mergeProviders') || !mergeProvidersUnchanged) {
    result.mergeProviders = [...form.mergeProviders];
  }

  const originalNotifications = openRecord(original.notifications);
  const notifications: Record<string, unknown> = { ...originalNotifications };
  for (const key of ['enabled', 'wind', 'visibility', 'heat', 'cold', 'weather'] as const) {
    if (
      !Object.hasOwn(originalNotifications, key) ||
      form.notifications[key] !== baselineForm.notifications[key]
    ) {
      notifications[key] = form.notifications[key];
    }
  }
  result.notifications = notifications;
  return result;
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

// Post-request status-check cadence: up to 4 polls, 1.5 s apart, before giving
// up. A readable status cannot prove that a void host callback persisted the
// request, so the result describes only the current plugin state.
const STATUS_POLL_ATTEMPTS = 4;
const STATUS_POLL_DELAY_MS = 1500;

function apiKeyErrorFor(form: PanelFormState, trimmedKey: string): string | null {
  const selectedProviders =
    form.weatherMode === 'single' ? [form.weatherProvider] : form.mergeProviders;
  const validateKey =
    selectionRequiresApiKey(form.weatherMode, form.weatherProvider, form.mergeProviders) ||
    (selectedProviders.some(providerRequiresApiKey) && trimmedKey !== '');
  return validateKey ? validateApiKeyCandidate(trimmedKey) : null;
}

function baseUrlErrorFor(form: PanelFormState): string | null {
  const openMeteoActive =
    form.weatherMode === 'single'
      ? form.weatherProvider === 'open-meteo'
      : form.mergeProviders.includes('open-meteo');
  return openMeteoActive ? validateOpenMeteoBaseUrlCandidate(form.openMeteoBaseUrl) : null;
}

async function checkStatusAfterRequest(
  refreshStatus: () => Promise<PanelStatusResponse | null>
): Promise<SaveAction> {
  let data: PanelStatusResponse | null = null;
  for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS && !data; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_DELAY_MS));
    data = await refreshStatus();
  }
  if (!data) {
    return {
      message: 'Save requested, but the current plugin status could not be read.',
      isError: true,
    };
  }
  return {
    message: data.running
      ? 'Save requested. Current plugin status is running.'
      : `Save requested. Current plugin status is not running: ${data.banner || 'unknown'}.`,
    isError: !data.running,
  };
}

export interface UsePanelConfigResult {
  form: PanelFormState;
  requestedForm: PanelFormState;
  dirty: boolean;
  saving: boolean;
  // Request and current-status outcome for the footer status line.
  action: SaveAction | null;
  // Inline blocker shown by ApiKeyField when Save rejects an invalid key.
  keyError: string | null;
  // Inline blocker shown by the Open-Meteo field when its URL cannot be used.
  baseUrlError: string | null;
  setField: <K extends keyof PanelFormState>(key: K, value: PanelFormState[K]) => void;
  setNotification: (key: keyof NotificationsFormState, value: boolean) => void;
  discard: () => void;
  clearKeyError: () => void;
  clearBaseUrlError: () => void;
  // Identifies the field that blocked a save, or null after submission, so the
  // caller can open the Weather source section and focus the inline error.
  doSave: () => Promise<SaveBlockerId | null>;
}

/**
 * Form state, dirty tracking, and the save flow for the config panel.
 *
 * Signal K Admin's save callback starts persistence and returns void before
 * the request settles. The panel reports that request, then polls /api/status
 * and describes the current plugin state without treating it as persistence
 * confirmation.
 */
export function usePanelConfig(
  configuration: unknown,
  hostSave: (config: unknown) => void,
  refreshStatus: () => Promise<PanelStatusResponse | null>
): UsePanelConfigResult {
  const [form, setForm] = useState<PanelFormState>(() => formStateFromConfig(configuration));
  // Last configuration supplied by the host or requested by this panel, in
  // form shape. This is the dirty baseline and the Discard target, but it does
  // not claim that Signal K completed persistence.
  const [requestedForm, setRequestedForm] = useState<PanelFormState>(form);
  const requestedConfigurationRef = useRef<Record<string, unknown>>(openRecord(configuration));
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<SaveAction | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const editVersionRef = useRef(0);

  // Resync when the host supplies a new configuration object (e.g. after a
  // save and restart), using the render-time previous-props pattern: React
  // re-runs this component immediately after the setState calls, before any
  // child renders. A clean form adopts the new config wholesale; a dirty form
  // keeps the user's unsaved edits and only moves the baseline.
  const [prevConfiguration, setPrevConfiguration] = useState(configuration);
  if (prevConfiguration !== configuration) {
    setPrevConfiguration(configuration);
    const next = formStateFromConfig(configuration);
    requestedConfigurationRef.current = openRecord(configuration);
    if (formsEqual(form, requestedForm)) setForm(next);
    setRequestedForm(next);
  }

  const setField = useCallback(
    <K extends keyof PanelFormState>(key: K, value: PanelFormState[K]): void => {
      editVersionRef.current += 1;
      setAction(null);
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setNotification = useCallback((key: keyof NotificationsFormState, value: boolean): void => {
    editVersionRef.current += 1;
    setAction(null);
    setForm((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  }, []);

  const discard = useCallback((): void => {
    setForm(requestedForm);
    setKeyError(null);
    setBaseUrlError(null);
    setAction(null);
  }, [requestedForm]);

  const clearKeyError = useCallback((): void => setKeyError(null), []);
  const clearBaseUrlError = useCallback((): void => setBaseUrlError(null), []);
  const setActionForEditVersion = useCallback((version: number, next: SaveAction): void => {
    if (editVersionRef.current === version) setAction(next);
  }, []);

  const doSave = useCallback(async (): Promise<SaveBlockerId | null> => {
    const submittedEditVersion = editVersionRef.current;
    const trimmedKey = form.accuWeatherApiKey.trim();
    const keyFormatError = apiKeyErrorFor(form, trimmedKey);
    if (keyFormatError) {
      setKeyError(keyFormatError);
      return 'svws-apikey';
    }
    setKeyError(null);
    const baseUrlError = baseUrlErrorFor(form);
    if (baseUrlError) {
      setBaseUrlError(baseUrlError);
      return 'svws-ombase';
    }
    setBaseUrlError(null);
    setSaving(true);
    setAction({ message: 'Requesting configuration save...', isError: false });
    try {
      const normalizedForm: PanelFormState = {
        ...form,
        accuWeatherApiKey: trimmedKey,
        openMeteoBaseUrl: form.openMeteoBaseUrl.trim(),
        notifications: { ...form.notifications },
      };
      const payload = configurationFromForm(
        normalizedForm,
        requestedConfigurationRef.current,
        requestedForm
      );
      try {
        hostSave(payload);
      } catch (err) {
        setAction({
          message: `Could not request the configuration save: ${toErrorText(err)}`,
          isError: true,
        });
        return null;
      }
      setAction({
        message: 'Configuration save requested. Checking current plugin status...',
        isError: false,
      });
      // What we handed the host is the requested baseline; adopting it as the form
      // too keeps dirty false even when trimming changed the key. Adopt only
      // if the user has not typed since Save was clicked: a mid-confirmation edit
      // must survive and stay dirty against the new baseline.
      setForm((current) => (formsEqual(current, form) ? normalizedForm : current));
      setRequestedForm(normalizedForm);
      requestedConfigurationRef.current = payload;
      try {
        const statusAction = await checkStatusAfterRequest(refreshStatus);
        setActionForEditVersion(submittedEditVersion, statusAction);
      } catch (err) {
        setActionForEditVersion(submittedEditVersion, {
          message: `Save requested, but the current status check failed: ${toErrorText(err)}`,
          isError: true,
        });
      }
    } catch (err) {
      setAction({
        message: `Could not prepare the configuration request: ${toErrorText(err)}`,
        isError: true,
      });
    } finally {
      setSaving(false);
    }
    return null;
  }, [form, hostSave, refreshStatus, requestedForm, setActionForEditVersion]);

  return {
    form,
    requestedForm,
    dirty: !formsEqual(form, requestedForm),
    saving,
    action,
    keyError,
    baseUrlError,
    setField,
    setNotification,
    discard,
    clearKeyError,
    clearBaseUrlError,
    doSave,
  };
}
