import type * as React from 'react';
import { useEffect, useState } from 'react';
import { LabeledField, NumberInput } from 'signalk-nearlcrews-ui';

interface Props {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  units: string;
  description: React.ReactNode;
  onChange: (next: number) => void;
  onValidityChange: (id: string, valid: boolean) => void;
}

function validateDraft(draft: string, min: number, max: number): string | null {
  const value = Number(draft);
  if (draft.trim() === '' || !Number.isFinite(value)) {
    return `Enter a whole number from ${min} to ${max}.`;
  }
  if (!Number.isInteger(value)) return 'Enter a whole number.';
  if (value < min || value > max) return `Enter a value from ${min} to ${max}.`;
  return null;
}

export default function IntegerField({
  id,
  label,
  value,
  min,
  max,
  units,
  description,
  onChange,
  onValidityChange,
}: Props): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const error = draft === null ? null : validateDraft(draft, min, max);

  useEffect(() => {
    setDraft(null);
    onValidityChange(id, true);
    return () => onValidityChange(id, true);
  }, [id, onValidityChange]);

  const updateDraft = (nextDraft: string): void => {
    setDraft(nextDraft);
    const nextError = validateDraft(nextDraft, min, max);
    onValidityChange(id, nextError === null);
    if (nextError === null) onChange(Number(nextDraft));
  };

  const finishEdit = (): void => {
    if (draft !== null && error === null) setDraft(null);
  };

  return (
    <LabeledField
      label={`${label} (${units})`}
      description={description}
      error={error}
      errorLive="polite"
    >
      <NumberInput
        id={id}
        min={min}
        max={max}
        step={1}
        value={draft ?? String(value)}
        onChange={(event) => updateDraft(event.target.value)}
        onBlur={finishEdit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finishEdit();
        }}
        onWheel={(event) => {
          if (document.activeElement === event.currentTarget) event.currentTarget.blur();
        }}
      />
    </LabeledField>
  );
}
