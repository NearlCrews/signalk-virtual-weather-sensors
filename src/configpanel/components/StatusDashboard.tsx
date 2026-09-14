import type * as React from 'react';
import {
  LiveRegion,
  Metric,
  MetricGrid,
  RelativeAge,
  Section,
  StatusIndicator,
} from 'signalk-nearlcrews-ui';
import { PLUGIN_DISPLAY_NAME } from '../../constants/notifications-shared.js';
import type { PanelStatusResponse } from '../../types/index.js';
import styles from './StatusDashboard.module.css';

const NA = 'n/a';

const STALE_ANNOUNCEMENT = 'Status updates have stalled. These numbers may be out of date.';

/** Announced beside a metric the panel knows may be out of date. */
const STALE_TONE_LABEL = 'Possibly out of date';

// The panel ships no translations, so the age stays in the language of the
// sentence around it rather than following the browser locale. The wording
// itself is the library default.
const AGE_OPTIONS = { locale: 'en' } as const;

// Counts follow the same rule as the relative age: one pinned locale, so a
// grouping separator cannot disagree with the English sentence around it.
const COUNT_LOCALE = 'en';

function count(value: number | undefined): string {
  return value === undefined ? NA : value.toLocaleString(COUNT_LOCALE);
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
  stale: boolean;
}

interface MetricsProps {
  status: PanelStatusResponse | null;
  stale: boolean;
}

/**
 * The five status counters.
 *
 * While the poll is stalled every metric carries a warning tone, so a stale
 * number is never visually identical to a live one. The tone badge renders a
 * glyph plus a visually hidden announcement, so the marking does not depend on
 * color. Split out of `StatusDashboard` so both halves stay within the
 * repository's cognitive-complexity budget.
 */
function StatusMetrics({ status, stale }: MetricsProps): React.ReactElement {
  const activeAlerts = status?.activeNotifications ?? 0;
  const weatherApiOn = status?.weatherProviderRegistered === true;
  const staleTone = stale ? ('warning' as const) : undefined;
  const staleToneLabel = stale ? STALE_TONE_LABEL : undefined;

  return (
    <MetricGrid>
      <Metric
        tone={staleTone}
        toneLabel={staleToneLabel}
        value={count(status?.updates)}
        label="Updates"
      />
      <Metric
        tone={staleTone}
        toneLabel={staleToneLabel}
        value={count(status?.quotaUsedLast24h)}
        unit="calls"
        label="API usage (24h)"
      />
      <Metric
        tone={activeAlerts > 0 ? 'warning' : staleTone}
        toneLabel={activeAlerts > 0 ? `${activeAlerts} active` : staleToneLabel}
        value={count(status?.activeNotifications)}
        label="Active alerts"
      />
      {/*
       * `lastUpdateMinutesAgo` is a server snapshot captured at the last
       * SUCCESSFUL poll, so while the poll is stalled it keeps reporting the
       * value it held then: ten minutes into a stall it would claim the weather
       * was one minute old. Report n/a rather than a number known to be wrong.
       */}
      <Metric
        tone={staleTone}
        toneLabel={staleToneLabel}
        value={stale || status?.lastUpdateMinutesAgo == null ? NA : status.lastUpdateMinutesAgo}
        unit="minutes"
        label="Since last fetch"
      />
      <Metric
        tone={status && !weatherApiOn ? 'warning' : staleTone}
        toneLabel={status && !weatherApiOn ? 'Not registered' : staleToneLabel}
        value={weatherApiOn ? 'On' : status ? 'Off' : NA}
        label="Weather API"
      />
    </MetricGrid>
  );
}

export default function StatusDashboard({
  status,
  loading,
  lastUpdatedMs,
  stale,
}: Props): React.ReactElement {
  const stateLabel = status ? (status.running ? 'Running' : 'Not running') : 'Unknown';
  const tone = status ? (status.running ? 'success' : 'danger') : 'neutral';
  const meta = status?.banner || (loading ? 'Loading status…' : stateLabel);

  return (
    <Section
      title={
        <span className={styles.heading}>
          <span className={styles.icon} aria-hidden="true">
            <WeatherGlyph />
          </span>
          {PLUGIN_DISPLAY_NAME}
        </span>
      }
      description={meta}
      actions={<StatusIndicator tone={tone}>{stateLabel}</StatusIndicator>}
    >
      {stale ? (
        <StatusIndicator tone="warning">
          Updated <RelativeAge since={lastUpdatedMs} options={AGE_OPTIONS} />
        </StatusIndicator>
      ) : null}
      {/*
       * The visible marker is deliberately not a live region. Its age ticks
       * every ten seconds, so a region wrapping it would re-announce for as
       * long as the poll stays down, and a region mounted with its text
       * already in place is not reliably observed anyway. This announcer is
       * always mounted and speaks the transition once.
       */}
      <LiveRegion message={stale ? STALE_ANNOUNCEMENT : ''} />

      <StatusMetrics status={status} stale={stale} />
    </Section>
  );
}
