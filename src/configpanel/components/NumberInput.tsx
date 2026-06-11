import type * as React from 'react';
import { useState } from 'react';
import { clampNumber } from '../api-base.js';
import { S } from '../styles.js';

interface Props {
  id: string;
  value: number;
  min: number;
  max: number;
  // Units hint rendered next to the field, e.g. "minutes" or "seconds".
  units: string;
  onChange: (next: number) => void;
}

/**
 * Integer input that holds a raw-text draft while the user edits, so the
 * field can be cleared mid-edit instead of snapping back to a number on every
 * keystroke. Commits a clamped, truncated integer on blur or Enter; an
 * unparseable or empty draft reverts to the last committed value.
 */
export default function NumberInput({
  id,
  value,
  min,
  max,
  units,
  onChange,
}: Props): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) {
      onChange(clampNumber(Math.trunc(n), min, max));
    }
    setDraft(null);
  };

  return (
    <>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        style={S.inputNumber}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        onWheel={(e) => {
          // A scroll gesture over a focused number field silently spins the
          // value. Dropping focus before the spin applies makes scrolling
          // past the field safe; an unfocused number input never spins.
          if (document.activeElement === e.currentTarget) e.currentTarget.blur();
        }}
      />
      <span style={S.unitsHint}>{units}</span>
    </>
  );
}
