import type * as React from 'react';
import {
  providerRequiresApiKey,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
  type WeatherProviderId,
} from '../../constants/notifications-shared.js';
import { S } from '../styles.js';
import CheckboxRow from './CheckboxRow.js';

interface Props {
  // Ordered list of included provider ids; the first entry is the primary.
  mergeProviders: ReadonlyArray<WeatherProviderId>;
  // Whether an AccuWeather key is set. When false, AccuWeather cannot be
  // included (its row's checkbox is disabled with a "needs a key" note),
  // because the merge has no way to fetch it.
  hasAccuWeatherKey: boolean;
  onChange: (next: WeatherProviderId[]) => void;
}

/**
 * Merge composition editor. Renders every known provider as a row: included
 * providers first in their merge order (reorderable among themselves), then
 * the still-available providers. The operator picks which providers blend and
 * in what priority order; the first included provider is the primary, which
 * sets the categorical-field picks, the tie-breaks, and the forecast source.
 *
 * Checking a row appends that provider to the end of the order; unchecking
 * removes it; the up and down buttons swap adjacent included entries. Every
 * edit produces a fresh ordered array passed to onChange. AccuWeather can be
 * included only when a key is set.
 *
 * Accessibility: the reorder buttons stay focusable at the bounds (they use
 * aria-disabled plus a guarded no-op rather than native disabled), so a
 * keyboard user who moves a row to the top or bottom keeps focus and can keep
 * reordering. A polite live region restates the order after every edit so the
 * change is announced to assistive tech.
 */
/**
 * Up and down reorder controls for one included row. aria-disabled, not
 * native disabled, so focus stays on the button after a move lands the row at
 * a bound; the handler no-ops there.
 */
function ReorderButtons({
  label,
  atTop,
  atBottom,
  onMove,
}: {
  label: string;
  atTop: boolean;
  atBottom: boolean;
  onMove: (direction: -1 | 1) => void;
}): React.ReactElement {
  return (
    <div style={S.mergeReorder}>
      <button
        type="button"
        style={S.reorderBtn}
        aria-label={`Move ${label} up`}
        aria-disabled={atTop}
        onClick={() => {
          if (!atTop) onMove(-1);
        }}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        style={S.reorderBtn}
        aria-label={`Move ${label} down`}
        aria-disabled={atBottom}
        onClick={() => {
          if (!atBottom) onMove(1);
        }}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </div>
  );
}

export default function MergeProviderList({
  mergeProviders,
  hasAccuWeatherKey,
  onChange,
}: Props): React.ReactElement {
  // Included rows come from mergeProviders in order; excluded rows are the
  // remaining catalog providers in catalog order, appended after.
  const included = mergeProviders;
  const excluded = WEATHER_PROVIDER_IDS.filter((id) => !included.includes(id));
  // Derived once per render rather than recomputed on every row.
  const lastIndex = included.length - 1;

  const include = (id: WeatherProviderId): void => {
    if (included.includes(id)) return;
    onChange([...included, id]);
  };

  const exclude = (id: WeatherProviderId): void => {
    onChange(included.filter((other) => other !== id));
  };

  // Swap the included entry at `index` with its neighbor in `direction`.
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    const atIndex = included[index];
    const atTarget = included[target];
    // Guards both the range and the noUncheckedIndexedAccess undefineds, and
    // narrows both locals away from undefined for the swap below.
    if (atIndex === undefined || atTarget === undefined) return;
    const next = [...included];
    next[index] = atTarget;
    next[target] = atIndex;
    onChange(next);
  };

  // Order restated for the polite live region after each edit: primary first,
  // so a screen reader user hears the resulting priority. The excluded count
  // rounds out the picture without naming every available provider.
  const orderSummary =
    included.length === 0
      ? 'No providers in the merge.'
      : `Merge order: ${included
          .map((id, i) => `${i + 1} ${WEATHER_PROVIDER_LABELS[id]}${i === 0 ? ' (primary)' : ''}`)
          .join(', ')}.`;

  /**
   * Whether a row's checkbox is locked, and the inline note explaining why.
   * AccuWeather with no key cannot be added (an already-included AccuWeather,
   * from a saved merge whose key was later cleared, stays toggle-able so the
   * operator can remove it). The last included provider cannot be unchecked:
   * an empty list would silently resolve back to the full default order at
   * runtime, the opposite of what an emptied list reads as in the panel.
   */
  const rowLockState = (
    id: WeatherProviderId,
    isIncluded: boolean
  ): { disabled: boolean; note: string | null } => {
    if (providerRequiresApiKey(id) && !hasAccuWeatherKey && !isIncluded) {
      return { disabled: true, note: 'needs an AccuWeather key (set it below)' };
    }
    if (isIncluded && included.length === 1) {
      return { disabled: true, note: 'at least one provider must stay in the merge' };
    }
    return { disabled: false, note: null };
  };

  const renderRow = (id: WeatherProviderId, includedIndex: number | null): React.ReactElement => {
    const isIncluded = includedIndex !== null;
    const isPrimary = includedIndex === 0;
    const isLastIncluded = isIncluded && includedIndex === lastIndex;
    const { disabled, note } = rowLockState(id, isIncluded);
    const label = WEATHER_PROVIDER_LABELS[id];
    const noteId = `svws-merge-${id}-note`;

    return (
      <div key={id} style={S.mergeRow}>
        <CheckboxRow
          id={`svws-merge-${id}`}
          label={label}
          checked={isIncluded}
          disabled={disabled}
          // Match the label emphasis to the disabled state, the same pairing
          // NotificationToggles uses for its disabled sub-toggles.
          variant={disabled ? 'disabled' : 'normal'}
          // The primary role rides into the accessible name so it is announced,
          // not conveyed by the visual pill alone.
          visuallyHiddenSuffix={isPrimary ? ', primary' : undefined}
          // Point a locked row's checkbox at its inline note so the reason is
          // part of the accessible description (the ApiKeyField idiom).
          describedBy={note !== null ? noteId : undefined}
          containerStyle={S.mergeRowMain}
          onChange={(checked) => (checked ? include(id) : exclude(id))}
        >
          {isPrimary ? <span style={S.primaryBadge}>primary</span> : null}
          {note !== null ? (
            <span id={noteId} style={S.mergeNote}>
              {note}
            </span>
          ) : null}
        </CheckboxRow>

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
    <fieldset style={S.fieldset}>
      <legend style={S.legend}>Providers in the merge</legend>
      {included.map((id, index) => renderRow(id, index))}
      {excluded.length > 0 ? (
        <p style={S.mergeAvailableHint}>
          Available (checking a provider adds it at the bottom of the order; reorder with the
          arrows):
        </p>
      ) : null}
      {excluded.map((id) => renderRow(id, null))}
      <p style={S.help}>
        The first provider is the primary: it sets the categorical-field picks, the tie-breaks, and
        the forecast source. Use the up and down buttons to set the priority order.
      </p>
      {/* Polite live region: restates the resulting order after each include,
          exclude, or reorder so the change is announced to assistive tech.
          Always mounted so it exists before the first edit. */}
      <p role="status" aria-live="polite" style={S.visuallyHidden}>
        {orderSummary}
      </p>
    </fieldset>
  );
}
