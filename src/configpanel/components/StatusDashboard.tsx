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

// The panel ships no translations, so every formatted value stays in the
// language of the sentence around it rather than following the browser locale:
// a relative age and a grouping separator cannot disagree with the English
// wording they sit in. The age wording itself is the library default.
const PANEL_LOCALE = 'en';

const AGE_OPTIONS = { locale: PANEL_LOCALE } as const;

function count(value: number | undefined): string {
  return value === undefined ? NA : value.toLocaleString(PANEL_LOCALE);
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

/** One status counter: its own warning condition, or the shared stale tone. */
interface MetricRow {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
  readonly warn?: boolean;
  readonly warnLabel?: string;
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

  // One row per metric, so the stale tone is resolved once below rather than
  // threaded onto each element: a metric that forgot the pair would render an
  // unmarked stale number, which is the failure this marking exists to prevent.
  const metrics: ReadonlyArray<MetricRow> = [
    { label: 'Updates', value: count(status?.updates) },
    { label: 'API usage (24h)', value: count(status?.quotaUsedLast24h), unit: 'calls' },
    {
      label: 'Active alerts',
      value: count(status?.activeNotifications),
      warn: activeAlerts > 0,
      warnLabel: `${activeAlerts} active`,
    },
    {
      // `lastUpdateMinutesAgo` is a server snapshot captured at the last
      // SUCCESSFUL poll, so while the poll is stalled it keeps reporting the
      // value it held then: ten minutes into a stall it would claim the weather
      // was one minute old. Report n/a rather than a number known to be wrong.
      label: 'Since last fetch',
      value: stale || status?.lastUpdateMinutesAgo == null ? NA : status.lastUpdateMinutesAgo,
      unit: 'minutes',
    },
    {
      label: 'Weather API',
      value: weatherApiOn ? 'On' : status ? 'Off' : NA,
      warn: status !== null && !weatherApiOn,
      warnLabel: 'Not registered',
    },
  ];

  return (
    <MetricGrid>
      {metrics.map(({ label, value, unit, warn, warnLabel }) => (
        <Metric
          key={label}
          tone={warn || stale ? 'warning' : undefined}
          toneLabel={warn ? warnLabel : stale ? STALE_TONE_LABEL : undefined}
          value={value}
          {...(unit !== undefined && { unit })}
          label={label}
        />
      ))}
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
