import type * as React from 'react';
import { Card, Cluster, Metric, MetricGrid, Stack, StatusIndicator } from 'signalk-nearlcrews-ui';
import { PLUGIN_DISPLAY_NAME } from '../../constants/notifications-shared.js';
import type { PanelStatusResponse } from '../../types/index.js';
import styles from './StatusDashboard.module.css';

const NA = 'n/a';

function count(value: number | undefined): string {
  return value === undefined ? NA : value.toLocaleString();
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
                ⛅
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
            {stale ? `Updated ${Math.round(staleAgeMs / 1000)} seconds ago` : ''}
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
