import type * as React from 'react';
import type { CSSProperties } from 'react';
import { PLUGIN_DISPLAY_NAME } from '../../constants/notifications-shared.js';
import type { PanelStatusResponse } from '../../types/index.js';
import { S } from '../styles.js';

// Placeholder for a stat that has no value yet (plugin stopped, or no status
// poll has succeeded). Plain text, never an em dash.
const NA = 'n/a';

interface StatProps {
  value: string;
  label: string;
}

function Stat({ value, label }: StatProps): React.ReactElement {
  return (
    <div style={S.statCard}>
      <div style={S.statValue}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

function count(n: number | undefined): string {
  return n === undefined ? NA : n.toLocaleString();
}

// Header-card presentation for the three plugin states: no snapshot yet,
// running, and stopped. Extracted so the component body stays a flat layout.
function headerState(
  status: PanelStatusResponse | null,
  loading: boolean
): { stateLabel: string; dotStyle: CSSProperties; meta: string } {
  if (!status) {
    return {
      stateLabel: 'Unknown',
      dotStyle: S.dotOff,
      meta: loading ? 'Loading status...' : 'Unknown',
    };
  }
  const stateLabel = status.running ? 'Running' : 'Not running';
  return {
    stateLabel,
    dotStyle: status.running ? S.dotOk : S.dotErr,
    meta: status.banner || stateLabel,
  };
}

interface Props {
  // Last-known status snapshot; kept on screen even when the plugin stops so
  // the operator retains context. Null before the first successful poll.
  status: PanelStatusResponse | null;
  loading: boolean;
  // Wall-clock timestamp (ms) of the last successful status poll, used for
  // the staleness marker.
  lastUpdatedMs: number | null;
  // Wall-clock timestamp (ms) of the last failed poll attempt; pairs with
  // lastUpdatedMs to compute the marker age without an impure Date.now().
  lastAttemptMs: number;
  // Staleness verdict owned by useStatus (the poll cadence lives there).
  stale: boolean;
}

export default function StatusDashboard({
  status,
  loading,
  lastUpdatedMs,
  lastAttemptMs,
  stale,
}: Props): React.ReactElement {
  const { stateLabel, dotStyle, meta } = headerState(status, loading);
  // stale implies a successful poll happened and a later attempt failed, so
  // the difference is the age of the on-screen snapshot as of that attempt.
  const staleAgeMs = lastUpdatedMs === null ? 0 : lastAttemptMs - lastUpdatedMs;

  return (
    <div role="status">
      <div style={S.card}>
        <div style={S.cardIcon} aria-hidden="true">
          ⛅
        </div>
        <div style={S.cardInfo}>
          <div style={S.cardTitle}>{PLUGIN_DISPLAY_NAME}</div>
          <div style={S.cardMeta}>{meta}</div>
        </div>
        {/* The dot always carries an adjacent text label: color alone is not
            a signal (color-blind operators, night-red theme). */}
        <span style={S.stateGroup}>
          <span style={{ ...S.dot, ...dotStyle }} aria-hidden="true" />
          <span style={S.dotLabel}>{stateLabel}</span>
        </span>
        {stale ? (
          <span style={S.staleMarker}>updated {Math.round(staleAgeMs / 1000)} s ago</span>
        ) : null}
      </div>

      {/* The grid renders in every state. When the plugin is stopped it shows
          the last-known values (or placeholders) so the layout never jumps
          and the operator keeps context. */}
      <div style={S.statsGrid}>
        <Stat value={count(status?.updates)} label="Updates" />
        <Stat value={count(status?.quotaUsedLast24h)} label="API calls (24h)" />
        <Stat value={count(status?.activeNotifications)} label="Active alerts" />
        <Stat
          value={status?.lastUpdateMinutesAgo == null ? NA : String(status.lastUpdateMinutesAgo)}
          label="Minutes since fetch"
        />
        <Stat
          value={status ? (status.weatherProviderRegistered ? 'On' : 'Off') : NA}
          label="Weather API"
        />
      </div>
    </div>
  );
}
