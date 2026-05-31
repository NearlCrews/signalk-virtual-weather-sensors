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
 * Polls `/plugins/signalk-virtual-weather-sensors/api/status` every 10 s for
 * live banner / quota / last-fetch / active-notifications / weather-provider
 * state and `/api/test-key`
 * is called on-demand from the API key field.
 */

import React, { useCallback, useEffect, useState } from 'react';
// Plain ESM JS shared with the TS plugin runtime so the federated panel and
// the rjsf schema cannot drift on label wording, numeric defaults, or key
// validation bounds.
import {
  API_KEY_MIN_LENGTH,
  CONFIG_DEFAULTS,
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_LABELS,
} from '../constants/notifications-shared.js';

const COLOR_OK = '#10b981';
const COLOR_ERR = '#ef4444';
// Neutral gray for the unknown / not-yet-loaded status indicator.
const COLOR_NEUTRAL = '#9ca3af';

// Typography shared by the plain and collapsible section headers.
const SECTION_TITLE_TYPE = {
  fontSize: 13,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 10,
  marginTop: 24,
};

// All styles live in a single `S` object: no CSS-in-JS library, no Tailwind,
// no stylesheets shipped in the bundle. Mirrors the QuestDB plugin convention.
const S = {
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#333',
    padding: '0 0 16px',
  },
  sectionTitle: SECTION_TITLE_TYPE,
  collapsibleTitle: {
    ...SECTION_TITLE_TYPE,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  chevron: {
    display: 'inline-block',
    fontSize: 10,
    transition: 'transform 0.15s',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 18px',
    background: '#f8f9fa',
    border: '1px solid #e0e0e0',
    borderRadius: 10,
    marginBottom: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    fontWeight: 700,
    flexShrink: 0,
    background: '#3b82f6',
    color: '#fff',
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: 600, color: '#333' },
  cardMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  stateIndicator: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    padding: '12px 14px',
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
  },
  statValue: { fontSize: 22, fontWeight: 700, color: '#333', lineHeight: 1.1 },
  statLabel: { fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#555',
    width: 220,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: '7px 10px',
    fontSize: 13,
    border: '1px solid #ccc',
    borderRadius: 6,
    background: '#fff',
    color: '#333',
    minWidth: 0,
  },
  inputNumber: {
    width: 100,
    padding: '7px 10px',
    fontSize: 13,
    border: '1px solid #ccc',
    borderRadius: 6,
    background: '#fff',
    color: '#333',
  },
  help: { fontSize: 12, color: '#888', marginLeft: 232, marginBottom: 12, marginTop: -4 },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  checkboxLabel: { fontSize: 13, color: '#444', cursor: 'pointer' },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnPrimary: { background: '#3b82f6', color: '#fff' },
  btnSecondary: { background: '#e5e7eb', color: '#333' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  status: { marginTop: 8, fontSize: 12, minHeight: 18 },
  empty: { padding: 16, color: '#999', fontStyle: 'italic', fontSize: 13 },
};

const API_BASE = '/plugins/signalk-virtual-weather-sensors/api';

// Rendering order comes from NOTIFICATION_LABELS property declaration order;
// keep that aligned with the rjsf schema's notifications.properties order in
// src/index.ts so the federated panel and the fallback form match.
const NOTIFICATION_TOGGLES = Object.entries(NOTIFICATION_LABELS).map(([key, label]) => ({
  key,
  label,
}));

/**
 * Derive form field values from a (possibly partial) saved config, filling
 * defaults from the shared module. Single source for the useState initializers
 * and the resync effect so a new field is added in one place, not two.
 */
function formStateFromConfig(c) {
  return {
    accuWeatherApiKey: c.accuWeatherApiKey || '',
    updateFrequency: c.updateFrequency ?? CONFIG_DEFAULTS.UPDATE_FREQUENCY,
    emissionInterval: c.emissionInterval ?? CONFIG_DEFAULTS.EMISSION_INTERVAL,
    dailyApiQuota: c.dailyApiQuota ?? CONFIG_DEFAULTS.DAILY_API_QUOTA,
    notifications: { ...DEFAULT_NOTIFICATIONS, ...(c.notifications || {}) },
  };
}

/**
 * Collapsible config section. Sections start collapsed so the panel opens as a
 * compact summary under the Status block; the operator expands only what they
 * intend to change.
 */
function Section({ title, open, onToggle, children }) {
  return (
    <>
      <button type="button" style={S.collapsibleTitle} onClick={onToggle} aria-expanded={open}>
        <span style={{ ...S.chevron, transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        {title}
      </button>
      {open && children}
    </>
  );
}

export default function PluginConfigurationPanel({ configuration, save }) {
  // Form state: one useState per editable field, mirroring the QuestDB
  // convention. Sub-objects (notifications) get their own state and are
  // re-assembled in doSave. Defaults flow through formStateFromConfig so the
  // panel and the rjsf schema can't drift on what "default" means.
  const initial = formStateFromConfig(configuration || {});
  const [accuWeatherApiKey, setAccuWeatherApiKey] = useState(initial.accuWeatherApiKey);
  const [updateFrequency, setUpdateFrequency] = useState(initial.updateFrequency);
  const [emissionInterval, setEmissionInterval] = useState(initial.emissionInterval);
  const [dailyApiQuota, setDailyApiQuota] = useState(initial.dailyApiQuota);
  const [notifications, setNotifications] = useState(initial.notifications);

  // Live data polled from the plugin's REST surface.
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Config sections collapse by default: the panel opens as a Status summary
  // and the operator expands only the section they came to edit.
  const [openSections, setOpenSections] = useState({
    apiKey: false,
    cadence: false,
    notifications: false,
  });
  const toggleSection = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Test-API-key button transient state. `state` is always paired with a
  // `message`, so collapsing into one object eliminates a class of bugs
  // where the two get out of sync between setters.
  const [testKey, setTestKey] = useState(
    /** @type {{state: null | 'pending' | 'ok' | 'error', message: string}} */ ({
      state: null,
      message: '',
    })
  );

  // Save transient state for the action bar (same coupling as testKey above).
  const [action, setAction] = useState(
    /** @type {{message: string, isError: boolean}} */ ({ message: '', isError: false })
  );

  // Resync form state when the host supplies a new configuration object (e.g.
  // after a save+restart): useState initializers run only once, so without
  // this the form would keep showing stale values on a configuration change.
  useEffect(() => {
    const next = formStateFromConfig(configuration || {});
    setAccuWeatherApiKey(next.accuWeatherApiKey);
    setUpdateFrequency(next.updateFrequency);
    setEmissionInterval(next.emissionInterval);
    setDailyApiQuota(next.dailyApiQuota);
    setNotifications(next.notifications);
  }, [configuration]);

  const fetchStatus = useCallback(async () => {
    let data = null;
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (res.ok) {
        data = await res.json();
        setStatus(data);
      }
    } catch {
      // Offline or plugin not running: leave previous status visible.
    }
    setStatusLoading(false);
    return data;
  }, []);

  useEffect(() => {
    // Skip polling when the admin tab is hidden: with multiple admin tabs
    // open across the fleet a hidden tab still polls and wastes CPU on the
    // SK server (especially noticeable on Pi-class hardware).
    const tickIfVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchStatus();
      }
    };
    tickIfVisible();
    // 10 s poll: status banner age advances per minute, quota updates on
    // each fetch (default 30 min cadence), so anything faster is wasted.
    const id = setInterval(tickIfVisible, 10_000);
    const onVisibility = () => {
      // Fetch immediately on becoming visible so the operator sees fresh
      // state without waiting up to 10 s for the next interval tick.
      if (document.visibilityState === 'visible') fetchStatus();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [fetchStatus]);

  const updateNotification = (key, value) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  };

  const doTestKey = async () => {
    const trimmed = accuWeatherApiKey.trim();
    if (trimmed.length < API_KEY_MIN_LENGTH) {
      setTestKey({
        state: 'error',
        message: `Key must be at least ${API_KEY_MIN_LENGTH} characters.`,
      });
      return;
    }
    setTestKey({ state: 'pending', message: 'Testing key against AccuWeather...' });
    try {
      const res = await fetch(`${API_BASE}/test-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestKey({ state: 'ok', message: data.message || 'API key works.' });
      } else {
        setTestKey({
          state: 'error',
          message: data.message || `Test failed (HTTP ${res.status}).`,
        });
      }
    } catch (err) {
      setTestKey({
        state: 'error',
        message: `Network error: ${err && err.message ? err.message : String(err)}`,
      });
    }
  };

  const doSave = async () => {
    // The host's save() may be sync OR return a Promise; wrap to handle both
    // and surface a real failure instead of an optimistic "Saved." that lied.
    // SK admin save() typically resolves with no value regardless of
    // server-side outcome, so we confirm by polling /api/status afterwards
    // and only report success when the plugin came back running.
    setAction({ message: 'Saving...', isError: false });
    try {
      await Promise.resolve(
        save({
          accuWeatherApiKey: accuWeatherApiKey.trim(),
          updateFrequency: Number(updateFrequency),
          emissionInterval: Number(emissionInterval),
          dailyApiQuota: Number(dailyApiQuota),
          notifications: { ...notifications },
        })
      );
      // The plugin is restarting, so /api/status may be briefly unreachable:
      // poll a few times before giving up rather than reporting a false success.
      let data = null;
      for (let attempt = 0; attempt < 4 && !data; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        data = await fetchStatus();
      }
      if (data) {
        setAction({
          message: data.running
            ? 'Saved. Plugin restarted with the new configuration.'
            : `Saved, but the plugin did not come back online: ${data.banner || 'unknown'}.`,
          isError: !data.running,
        });
        return;
      }
      // Never reached a readable status: report honestly rather than claiming success.
      setAction({
        message: 'Saved, but could not confirm the plugin restarted. Check the plugin status.',
        isError: true,
      });
    } catch (err) {
      setAction({
        message: `Save failed: ${err && err.message ? err.message : String(err)}`,
        isError: true,
      });
    }
  };

  const isRunning = status?.running;
  const indicatorColor = !status ? COLOR_NEUTRAL : isRunning ? COLOR_OK : COLOR_ERR;
  const stateLabel = !status ? 'Unknown' : isRunning ? 'Running' : 'Not running';

  return (
    <div style={S.root}>
      {/* Live status section: matches the QuestDB pattern of a single header
          card plus a stats grid, so the operator sees runtime state at the
          top of the form before touching any input. */}
      <div style={{ ...S.sectionTitle, marginTop: 0 }}>Status</div>

      {statusLoading ? (
        <div style={S.empty}>Loading...</div>
      ) : (
        <>
          <div style={S.card}>
            <div style={S.cardIcon}>VW</div>
            <div style={S.cardInfo}>
              <div style={S.cardTitle}>Virtual Weather Sensors</div>
              <div style={S.cardMeta}>{status?.banner || stateLabel}</div>
            </div>
            <div style={{ ...S.stateIndicator, background: indicatorColor }} title={stateLabel} />
          </div>

          {isRunning && (
            <div style={S.statsGrid}>
              <div style={S.statCard}>
                <div style={S.statValue}>{status.updates ?? 0}</div>
                <div style={S.statLabel}>Updates</div>
              </div>
              <div style={S.statCard}>
                <div style={S.statValue}>{status.quotaUsedLast24h ?? 0}</div>
                <div style={S.statLabel}>API calls (24h)</div>
              </div>
              <div style={S.statCard}>
                <div style={S.statValue}>{status.activeNotifications ?? 0}</div>
                <div style={S.statLabel}>Active alerts</div>
              </div>
              <div style={S.statCard}>
                <div style={S.statValue}>{status.lastUpdateMinutesAgo ?? '-'}</div>
                <div style={S.statLabel}>Min since fetch</div>
              </div>
              <div style={S.statCard}>
                <div style={S.statValue}>{status.weatherProviderRegistered ? 'On' : 'Off'}</div>
                <div style={S.statLabel}>Weather API</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* API key with inline test button. */}
      <Section
        title="AccuWeather API key"
        open={openSections.apiKey}
        onToggle={() => toggleSection('apiKey')}
      >
        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="vws-apikey">API key</label>
          <input
            id="vws-apikey"
            type="password"
            autoComplete="off"
            placeholder="paste your AccuWeather developer API key"
            value={accuWeatherApiKey}
            onChange={(e) => setAccuWeatherApiKey(e.target.value)}
            style={S.input}
          />
          <button
            type="button"
            onClick={doTestKey}
            disabled={testKey.state === 'pending'}
            style={{
              ...S.btn,
              ...S.btnSecondary,
              ...(testKey.state === 'pending' ? S.btnDisabled : {}),
            }}
          >
            {testKey.state === 'pending' ? 'Testing...' : 'Test'}
          </button>
        </div>
        <div style={S.help}>
          Get one free at <a href="https://developer.accuweather.com/" target="_blank" rel="noreferrer">developer.accuweather.com</a>.
          Minimum {API_KEY_MIN_LENGTH} characters.
        </div>
        {testKey.state && testKey.state !== 'pending' && (
          <div
            style={{
              ...S.status,
              color: testKey.state === 'ok' ? COLOR_OK : COLOR_ERR,
              marginLeft: 232,
            }}
          >
            {testKey.message}
          </div>
        )}
      </Section>

      {/* Fetch cadence: updateFrequency + emissionInterval + dailyApiQuota. */}
      <Section
        title="Fetch and emission cadence"
        open={openSections.cadence}
        onToggle={() => toggleSection('cadence')}
      >
        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="vws-update">Weather update frequency</label>
          <input
            id="vws-update"
            type="number"
            min={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN}
            max={CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX}
            value={updateFrequency}
            onChange={(e) => setUpdateFrequency(e.target.value)}
            style={S.inputNumber}
          />
          <span style={{ fontSize: 13, color: '#666' }}>minutes</span>
        </div>
        <div style={S.help}>
          Each fetch costs one AccuWeather API call. 30 min uses 48 calls/day, comfortably under the free-tier 50/day cap.
        </div>

        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="vws-emission">NMEA2000 broadcast interval</label>
          <input
            id="vws-emission"
            type="number"
            min={CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN}
            max={CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX}
            value={emissionInterval}
            onChange={(e) => setEmissionInterval(e.target.value)}
            style={S.inputNumber}
          />
          <span style={{ fontSize: 13, color: '#666' }}>seconds</span>
        </div>
        <div style={S.help}>
          How often the cached weather payload is re-emitted to the Signal K bus.
          Independent of the AccuWeather fetch cadence.
        </div>

        <div style={S.fieldRow}>
          <label style={S.label} htmlFor="vws-quota">Daily API call quota</label>
          <input
            id="vws-quota"
            type="number"
            min={CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN}
            max={CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX}
            value={dailyApiQuota}
            onChange={(e) => setDailyApiQuota(e.target.value)}
            style={S.inputNumber}
          />
          <span style={{ fontSize: 13, color: '#666' }}>calls / 24h (0 = no cap)</span>
        </div>
        <div style={S.help}>
          At 90% usage the banner warns; at 100% fetches pause until the rolling window drops.
        </div>
      </Section>

      {/* Notifications: master toggle gates 5 sub-toggles so an "all on / all off"
          flick is one click without losing per-category granularity. */}
      <Section
        title="Severe-weather notifications"
        open={openSections.notifications}
        onToggle={() => toggleSection('notifications')}
      >
        <div style={S.checkboxRow}>
          <input
            id="vws-notif-enabled"
            type="checkbox"
            checked={notifications.enabled}
            onChange={(e) => updateNotification('enabled', e.target.checked)}
          />
          <label htmlFor="vws-notif-enabled" style={{ ...S.checkboxLabel, fontWeight: 600 }}>
            Enable PGN notifications
          </label>
        </div>

        {NOTIFICATION_TOGGLES.map((row) => (
          <div key={row.key} style={{ ...S.checkboxRow, opacity: notifications.enabled ? 1 : 0.5 }}>
            <input
              id={`vws-notif-${row.key}`}
              type="checkbox"
              checked={!!notifications[row.key]}
              disabled={!notifications.enabled}
              onChange={(e) => updateNotification(row.key, e.target.checked)}
            />
            <label htmlFor={`vws-notif-${row.key}`} style={S.checkboxLabel}>
              {row.label}
            </label>
          </div>
        ))}
      </Section>

      {/* Action bar: save status below the button so the button never shifts
          when a "Saving..." / "Saved" message appears or clears. */}
      <div style={{ marginTop: 24 }}>
        <button type="button" onClick={doSave} style={{ ...S.btn, ...S.btnPrimary }}>
          Save Configuration
        </button>
      </div>

      {action.message && (
        <div
          style={{
            ...S.status,
            color: action.isError ? COLOR_ERR : COLOR_OK,
            marginTop: 12,
          }}
        >
          {action.message}
        </div>
      )}
    </div>
  );
}
