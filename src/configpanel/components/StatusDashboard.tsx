import type * as React from 'react';
import {
  Card,
  Cluster,
  formatRelativeAge,
  Metric,
  MetricGrid,
  Stack,
  StatusIndicator,
} from 'signalk-nearlcrews-ui';
import { PLUGIN_DISPLAY_NAME } from '../../constants/notifications-shared.js';
import type { PanelStatusResponse } from '../../types/index.js';
import styles from './StatusDashboard.module.css';

const NA = 'n/a';

function count(value: number | undefined): string {
  return value === undefined ? NA : value.toLocaleString();
}

function WeatherGlyph(): React.ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none">
      <path d="M7.25 7.25 5.8 5.8M12 5.25V3.5M5.25 12H3.5" />
      <path d="M8.2 14.5a4.25 4.25 0 1 1 7.58-3.2" />
      <path d="M7.25 19.25h10a3.25 3.25 0 0 0 .17-6.5 5 5 0 0 0-9.48 1.07 2.75 2.75 0 0 0-.69 5.43Z" />
    </svg>
  );
}

interface Props {
  status: PanelStatusResponse | null;
  loading: boolean;
  lastUpdatedMs: number | null;
  lastAttemptMs: number;
  stale: boolean;
}

export default function StatusDashboard({
  status,
  loading,
  lastUpdatedMs,
  lastAttemptMs,
  stale,
}: Props): React.ReactElement {
  const stateLabel = status ? (status.running ? 'Running' : 'Not running') : 'Unknown';
  const tone = status ? (status.running ? 'success' : 'danger') : 'neutral';
  const meta = status?.banner || (loading ? 'Loading status...' : stateLabel);
  const staleAgeMs = lastUpdatedMs === null ? 0 : Math.max(0, lastAttemptMs - lastUpdatedMs);

  return (
    <section aria-labelledby="svws-status-heading">
      <Stack gap={3}>
        <Card>
          <Cluster align="center" justify="between">
            <Cluster align="center">
              <span className={styles.icon} aria-hidden="true">
                <WeatherGlyph />
              </span>
              <div>
                <h2 className={styles.title} id="svws-status-heading">
                  {PLUGIN_DISPLAY_NAME}
                </h2>
                <p className={styles.meta}>{meta}</p>
              </div>
            </Cluster>
            <StatusIndicator tone={tone}>{stateLabel}</StatusIndicator>
          </Cluster>
          <p className={styles.freshness} role="status" aria-live="polite">
            {stale
              ? `Updated ${formatRelativeAge(staleAgeMs, {
                  fallback: 'unknown',
                  locale: 'en',
                  numeric: 'auto',
                  style: 'long',
                })}`
              : ''}
          </p>
        </Card>

        <MetricGrid aria-live="off">
          <Metric value={count(status?.updates)} label="Updates" />
          <Metric value={count(status?.quotaUsedLast24h)} label="API calls (24h)" />
          <Metric value={count(status?.activeNotifications)} label="Active alerts" />
          <Metric
            value={status?.lastUpdateMinutesAgo == null ? NA : status.lastUpdateMinutesAgo}
            label="Minutes since fetch"
          />
          <Metric
            value={status ? (status.weatherProviderRegistered ? 'On' : 'Off') : NA}
            label="Weather API"
          />
        </MetricGrid>
      </Stack>
    </section>
  );
}
