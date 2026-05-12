/**
 * React config panel for signalk-virtual-weather-sensors.
 *
 * Loaded by the Signal K Admin UI v2.13+ via Module Federation (see
 * webpack.config.js). The `signalk-plugin-configurator` keyword in
 * package.json is what triggers the host to load this panel in place of the
 * default rjsf-rendered form.
 *
 * Receives two props from the host:
 *   - `configuration`: the current saved plugin config object
 *   - `save(newConfig)`: persists the config and restarts the plugin
 *
 * Polls `/plugins/signalk-virtual-weather-sensors/api/status` every 10 s for
 * live banner / quota / last-fetch / active-notifications data and `/api/test-key`
 * is called on-demand from the API key field.
 */

import React, { useCallback, useEffect, useState } from 'react';

// All styles live in a single `S` object: no CSS-in-JS library, no Tailwind,
// no stylesheets shipped in the bundle. Mirrors the QuestDB plugin convention.
const S = {
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#333',
    padding: '16px 0',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 10,
    marginTop: 24,
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

const DEFAULT_NOTIFICATIONS = {
  enabled: false,
  wind: true,
  visibility: true,
  heat: true,
  cold: true,
  weather: true,
};

const NOTIFICATION_TOGGLES = [
  { key: 'wind', label: 'Wind alerts (gale / storm / hurricane)' },
  { key: 'visibility', label: 'Reduced-visibility alerts' },
  { key: 'heat', label: 'Heat-stress alerts' },
  { key: 'cold', label: 'Cold-exposure alerts' },
  { key: 'weather', label: 'Severe-condition alerts (thunderstorm / ice / freezing rain)' },
];

export default function PluginConfigurationPanel({ configuration, save }) {
  const cfg = configuration || {};

  // Form state: one useState per editable field, mirroring the QuestDB
  // convention. Sub-objects (notifications) get their own state and are
  // re-assembled in doSave.
  const [accuWeatherApiKey, setAccuWeatherApiKey] = useState(cfg.accuWeatherApiKey || '');
  const [updateFrequency, setUpdateFrequency] = useState(cfg.updateFrequency || 30);
  const [emissionInterval, setEmissionInterval] = useState(cfg.emissionInterval || 5);
  const [dailyApiQuota, setDailyApiQuota] = useState(cfg.dailyApiQuota ?? 50);
  const [notifications, setNotifications] = useState({
    ...DEFAULT_NOTIFICATIONS,
    ...(cfg.notifications || {}),
  });

  // Live data polled from the plugin's REST surface.
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Test-API-key button transient state.
  const [testKeyState, setTestKeyState] = useState(/** @type {null | 'pending' | 'ok' | 'error'} */ (null));
  const [testKeyMessage, setTestKeyMessage] = useState('');

  // Save transient state for the action bar.
  const [actionStatus, setActionStatus] = useState('');
  const [actionError, setActionError] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Offline or plugin not running: leave previous status visible.
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    // 10 s poll: status banner age advances per minute, quota updates on
    // each fetch (default 30 min cadence), so anything faster is wasted.
    const id = setInterval(fetchStatus, 10_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const updateNotification = (key, value) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  };

  const doTestKey = async () => {
    const trimmed = accuWeatherApiKey.trim();
    if (trimmed.length < 20) {
      setTestKeyState('error');
      setTestKeyMessage('Key must be at least 20 characters.');
      return;
    }
    setTestKeyState('pending');
    setTestKeyMessage('Testing key against AccuWeather...');
    try {
      const res = await fetch(`${API_BASE}/test-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestKeyState('ok');
        setTestKeyMessage(data.message || 'API key works.');
      } else {
        setTestKeyState('error');
        setTestKeyMessage(data.message || `Test failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      setTestKeyState('error');
      setTestKeyMessage(`Network error: ${err && err.message ? err.message : String(err)}`);
    }
  };

  const doSave = async () => {
    // The host's save() may be sync OR return a Promise; wrap to handle both
    // and surface a real failure instead of an optimistic "Saved." that lied.
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
      setActionStatus('Saved. Plugin will restart with the new configuration.');
      setActionError(false);
    } catch (err) {
      setActionStatus(`Save failed: ${err && err.message ? err.message : String(err)}`);
      setActionError(true);
    }
  };

  const isRunning = status && status.running;
  const indicatorColor = !status ? '#9ca3af' : isRunning ? '#10b981' : '#ef4444';
  const stateLabel = !status ? 'Unknown' : isRunning ? 'Running' : 'Not running';

  return (
    <div style={S.root}>
      {/* Live status section: matches the QuestDB pattern of a single header
          card plus a stats grid, so the operator sees runtime state at the
          top of the form before touching any input. */}
      <div style={S.sectionTitle}>Status</div>

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
            </div>
          )}
        </>
      )}

      {/* API key with inline test button. */}
      <div style={S.sectionTitle}>AccuWeather API key</div>

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
          disabled={testKeyState === 'pending'}
          style={{
            ...S.btn,
            ...S.btnSecondary,
            ...(testKeyState === 'pending' ? S.btnDisabled : {}),
          }}
        >
          {testKeyState === 'pending' ? 'Testing...' : 'Test'}
        </button>
      </div>
      <div style={S.help}>
        Get one free at <a href="https://developer.accuweather.com/" target="_blank" rel="noreferrer">developer.accuweather.com</a>.
        Minimum 20 characters.
      </div>
      {testKeyState && testKeyState !== 'pending' && (
        <div
          style={{
            ...S.status,
            color: testKeyState === 'ok' ? '#10b981' : '#ef4444',
            marginLeft: 232,
          }}
        >
          {testKeyMessage}
        </div>
      )}

      {/* Fetch cadence: updateFrequency + emissionInterval + dailyApiQuota. */}
      <div style={S.sectionTitle}>Fetch and emission cadence</div>

      <div style={S.fieldRow}>
        <label style={S.label} htmlFor="vws-update">Weather update frequency</label>
        <input
          id="vws-update"
          type="number"
          min={1}
          max={60}
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
          min={1}
          max={60}
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
          min={0}
          max={1000}
          value={dailyApiQuota}
          onChange={(e) => setDailyApiQuota(e.target.value)}
          style={S.inputNumber}
        />
        <span style={{ fontSize: 13, color: '#666' }}>calls / 24h (0 = no cap)</span>
      </div>
      <div style={S.help}>
        At 90% usage the banner warns; at 100% fetches pause until the rolling window drops.
      </div>

      {/* Notifications: master toggle gates 5 sub-toggles so an "all on / all off"
          flick is one click without losing per-category granularity. */}
      <div style={S.sectionTitle}>Severe-weather notifications</div>

      <div style={S.checkboxRow}>
        <input
          id="vws-notif-enabled"
          type="checkbox"
          checked={notifications.enabled}
          onChange={(e) => updateNotification('enabled', e.target.checked)}
        />
        <label htmlFor="vws-notif-enabled" style={{ ...S.checkboxLabel, fontWeight: 600 }}>
          Enable notifications
        </label>
      </div>
      <div style={S.help}>
        Emits Signal K notifications on <code>notifications.environment.*</code> when thresholds are crossed.
        Bridges to NMEA 2000 Alert PGNs (126983/126985) only when <code>signalk-to-nmea2000</code> is installed.
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

      {/* Action bar: save status above the button so the operator sees the
          confirmation message without scrolling. */}
      {actionStatus && (
        <div
          style={{
            ...S.status,
            color: actionError ? '#ef4444' : '#10b981',
            marginTop: 16,
          }}
        >
          {actionStatus}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <button type="button" onClick={doSave} style={{ ...S.btn, ...S.btnPrimary }}>
          Save Configuration
        </button>
      </div>
    </div>
  );
}
