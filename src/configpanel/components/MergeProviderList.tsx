import type * as React from 'react';
import { useEffect, useRef } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  FieldGroup,
  LiveRegion,
  Stack,
  Text,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import {
  providerRequiresApiKey,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
  WEATHER_PROVIDER_SHORT_LABELS,
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
        iconOnly
        aria-label={`Move ${label} up`}
        ariaDisabled={atTop}
        onClick={() => onMove(-1)}
      >
        <span aria-hidden="true">↑</span>
      </Button>
      <Button
        size="compact"
        variant="ghost"
        iconOnly
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

  /**
   * Row containers by provider id, so focus can be restored to a specific row
   * after the list re-renders. Populated by the ref callback in `renderRow`.
   */
  const rowRefs = useRef(new Map<WeatherProviderId, HTMLDivElement | null>());
  /** The row the operator last acted on, consumed once by the focus effect. */
  const pendingFocusId = useRef<WeatherProviderId | null>(null);
  /**
   * False until after the first render. The merge list mounts only when the
   * operator switches Provider mode to "merged", at which point the order
   * summary is already a complete sentence, and a live region whose FIRST
   * render carries text is not reliably observed (some screen readers instead
   * announce the whole thing on arrival). Seed it empty, then let the first
   * real change speak.
   */
  const announcerReady = useRef(false);

  useEffect(() => {
    announcerReady.current = true;
  }, []);

  /**
   * Put focus back where the operator left it after a change re-renders the
   * list.
   *
   * Two things can take focus away. A row that changes group is a different
   * child of the same list, and a row can become natively `disabled` as a
   * direct result of the change (the last included provider locks, and an
   * excluded provider that needs a key locks): a browser blurs a focused
   * control the moment it becomes disabled. Either way focus lands on
   * `document.body` with nothing announced, and a keyboard or screen-reader
   * operator has to tab through the whole panel again.
   */
  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) return;
    pendingFocusId.current = null;

    const rows = rowRefs.current;
    const active = document.activeElement;
    // Only intervene when the browser actually dropped focus out of the list;
    // never steal it from wherever the operator has since moved.
    if (active !== null && Array.from(rows.values()).some((node) => node?.contains(active))) {
      return;
    }

    const focusRow = (candidate: WeatherProviderId): boolean => {
      const input = rows.get(candidate)?.querySelector('input');
      if (!input || input.disabled) return false;
      input.focus();
      return true;
    };

    if (focusRow(id)) return;
    // The row the operator acted on is now locked, so fall to the nearest
    // control that can still be reached, in the order the list renders.
    for (const candidate of [...included, ...excluded]) {
      if (candidate !== id && focusRow(candidate)) return;
    }
  });

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
              `${index + 1} ${WEATHER_PROVIDER_SHORT_LABELS[id]}${index === 0 ? ' (primary)' : ''}`
          )
          .join(', ')}.`;

  const rowLockState = (
    id: WeatherProviderId,
    isIncluded: boolean
  ): { disabled: boolean; note: string | undefined } => {
    const keyMissing = providerRequiresApiKey(id) && !hasAccuWeatherKey;
    // The last included provider is locked whatever its key state. An empty
    // list is not saved as an empty merge: resolveMergeProviders reads it as
    // absent and restores every provider, the opposite of what unchecking the
    // final row asks for.
    if (isIncluded && included.length === 1) {
      return {
        disabled: true,
        note: keyMissing
          ? 'At least one provider must stay in the merge. This one stays excluded from fetching until an AccuWeather key is set.'
          : 'At least one provider must stay in the merge.',
      };
    }
    if (keyMissing) {
      return isIncluded
        ? { disabled: false, note: 'Excluded from fetching until an AccuWeather key is set.' }
        : { disabled: true, note: 'Needs an AccuWeather key. Set it below first.' };
    }
    return { disabled: false, note: undefined };
  };

  const renderRow = (id: WeatherProviderId, includedIndex: number | null): React.ReactElement => {
    const isIncluded = includedIndex !== null;
    const isPrimary = includedIndex === 0;
    const isLastIncluded = isIncluded && includedIndex === lastIndex;
    const { disabled, note } = rowLockState(id, isIncluded);
    const label = WEATHER_PROVIDER_LABELS[id];
    const shortLabel = WEATHER_PROVIDER_SHORT_LABELS[id];

    return (
      <div
        className={styles.row}
        key={id}
        ref={(node) => {
          rowRefs.current.set(id, node);
        }}
      >
        <Checkbox
          className={styles.checkbox}
          label={
            <>
              {label}
              {isPrimary ? <VisuallyHidden>, primary</VisuallyHidden> : null}
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
          onChange={(event) => {
            pendingFocusId.current = id;
            if (event.target.checked) include(id);
            else exclude(id);
          }}
        />
        {isIncluded ? (
          <ReorderButtons
            // The short name, not the provider picker's full marketing string:
            // there are six of these buttons and a screen-reader operator hears
            // the name on every arrow press.
            label={shortLabel}
            atTop={isPrimary}
            atBottom={isLastIncluded}
            onMove={(direction) => {
              pendingFocusId.current = id;
              move(includedIndex, direction);
            }}
          />
        ) : null}
      </div>
    );
  };

  /**
   * ONE keyed list across both groups. Rendering the included and excluded
   * arrays as separate children of the Stack made a provider that changes group
   * an unmount plus a mount rather than a move, so the checkbox the operator
   * just activated ceased to exist and focus fell to the document body.
   */
  const rows: React.ReactNode[] = included.map((id, index) => renderRow(id, index));
  if (excluded.length > 0) {
    rows.push(
      <Text as="p" tone="muted" size="sm" className={styles.available} key="available-heading">
        Available providers are added to the bottom of the order.
      </Text>,
      ...excluded.map((id) => renderRow(id, null))
    );
  }

  return (
    <FieldGroup
      legend="Providers in the merge"
      description="The first provider is primary. It supplies categorical fields, tie-breaks, and the forecast source."
    >
      <Stack gap={2}>{rows}</Stack>
      <LiveRegion as="p" message={announcerReady.current ? orderSummary : ''} />
    </FieldGroup>
  );
}
