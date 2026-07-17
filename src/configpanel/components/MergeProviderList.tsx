import type * as React from 'react';
import { Badge, Button, Checkbox, FieldGroup, Stack } from 'signalk-nearlcrews-ui';
import {
  providerRequiresApiKey,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
  type WeatherProviderId,
} from '../../constants/notifications-shared.js';
import styles from './MergeProviderList.module.css';

interface Props {
  mergeProviders: ReadonlyArray<WeatherProviderId>;
  hasAccuWeatherKey: boolean;
  onChange: (next: WeatherProviderId[]) => void;
}

interface ReorderButtonsProps {
  label: string;
  atTop: boolean;
  atBottom: boolean;
  onMove: (direction: -1 | 1) => void;
}

function ReorderButtons({
  label,
  atTop,
  atBottom,
  onMove,
}: ReorderButtonsProps): React.ReactElement {
  return (
    <div className={styles.reorder}>
      <Button
        size="compact"
        variant="ghost"
        aria-label={`Move ${label} up`}
        ariaDisabled={atTop}
        onClick={() => onMove(-1)}
      >
        <span aria-hidden="true">↑</span>
      </Button>
      <Button
        size="compact"
        variant="ghost"
        aria-label={`Move ${label} down`}
        ariaDisabled={atBottom}
        onClick={() => onMove(1)}
      >
        <span aria-hidden="true">↓</span>
      </Button>
    </div>
  );
}

export default function MergeProviderList({
  mergeProviders,
  hasAccuWeatherKey,
  onChange,
}: Props): React.ReactElement {
  const included = mergeProviders;
  const excluded = WEATHER_PROVIDER_IDS.filter((id) => !included.includes(id));
  const lastIndex = included.length - 1;

  const include = (id: WeatherProviderId): void => {
    if (!included.includes(id)) onChange([...included, id]);
  };
  const exclude = (id: WeatherProviderId): void => {
    onChange(included.filter((other) => other !== id));
  };
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    const atIndex = included[index];
    const atTarget = included[target];
    if (atIndex === undefined || atTarget === undefined) return;
    const next = [...included];
    next[index] = atTarget;
    next[target] = atIndex;
    onChange(next);
  };

  const orderSummary =
    included.length === 0
      ? 'No providers in the merge.'
      : `Merge order: ${included
          .map(
            (id, index) =>
              `${index + 1} ${WEATHER_PROVIDER_LABELS[id]}${index === 0 ? ' (primary)' : ''}`
          )
          .join(', ')}.`;

  const rowLockState = (
    id: WeatherProviderId,
    isIncluded: boolean
  ): { disabled: boolean; note: string | undefined } => {
    if (providerRequiresApiKey(id) && !hasAccuWeatherKey && !isIncluded) {
      return { disabled: true, note: 'Needs an AccuWeather key. Set it below first.' };
    }
    if (isIncluded && included.length === 1) {
      return { disabled: true, note: 'At least one provider must stay in the merge.' };
    }
    return { disabled: false, note: undefined };
  };

  const renderRow = (id: WeatherProviderId, includedIndex: number | null): React.ReactElement => {
    const isIncluded = includedIndex !== null;
    const isPrimary = includedIndex === 0;
    const isLastIncluded = isIncluded && includedIndex === lastIndex;
    const { disabled, note } = rowLockState(id, isIncluded);
    const label = WEATHER_PROVIDER_LABELS[id];

    return (
      <div className={styles.row} key={id}>
        <Checkbox
          id={`svws-merge-${id}`}
          className={styles.checkbox}
          label={
            <>
              {label}
              {isPrimary ? <span className={styles.visuallyHidden}>, primary</span> : null}
              {isPrimary ? (
                <Badge aria-hidden="true" className={styles.badge} tone="info">
                  primary
                </Badge>
              ) : null}
            </>
          }
          description={note}
          checked={isIncluded}
          disabled={disabled}
          onChange={(event) => (event.target.checked ? include(id) : exclude(id))}
        />
        {isIncluded ? (
          <ReorderButtons
            label={label}
            atTop={isPrimary}
            atBottom={isLastIncluded}
            onMove={(direction) => move(includedIndex, direction)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <FieldGroup
      legend="Providers in the merge"
      description="The first provider is primary. It supplies categorical fields, tie-breaks, and the forecast source."
    >
      <Stack gap={2}>
        {included.map((id, index) => renderRow(id, index))}
        {excluded.length > 0 ? (
          <p className={styles.available}>
            Available providers are added to the bottom of the order.
          </p>
        ) : null}
        {excluded.map((id) => renderRow(id, null))}
      </Stack>
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {orderSummary}
      </p>
    </FieldGroup>
  );
}
