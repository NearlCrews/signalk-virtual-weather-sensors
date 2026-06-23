import type * as React from 'react';
import { S } from '../styles.js';

// Label emphasis variants. The notifications master toggle reads strong; a
// disabled label keeps the faint token (AA in every palette) rather than
// stacking opacity; everything else is the normal weight.
export type CheckboxLabelVariant = 'normal' | 'strong' | 'disabled';

const LABEL_STYLE: Readonly<Record<CheckboxLabelVariant, React.CSSProperties>> = {
  normal: S.checkboxLabel,
  strong: S.checkboxLabelStrong,
  disabled: S.checkboxLabelDisabled,
};

interface Props {
  // Shared by the input id and the label's htmlFor, so the label is the
  // checkbox's accessible name and a click on either toggles the control.
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  // Picks the label weight and color. Defaults to the normal label; callers
  // pass 'disabled' so the faint token wins even on a control that is not
  // natively disabled.
  variant?: CheckboxLabelVariant | undefined;
  // Appended to the accessible name only (visually hidden), so a role marker
  // like ", primary" is announced without a second visible label.
  visuallyHiddenSuffix?: string | undefined;
  // Forwarded to the checkbox's aria-describedby, pointing at a sibling note
  // (for example a "needs a key" explanation) the caller renders in children.
  describedBy?: string | undefined;
  // Container for the checkbox-plus-label cluster. Defaults to the standard
  // row; the merge list passes its row-main style so the cluster can sit
  // beside a reorder control inside a wider row.
  containerStyle?: React.CSSProperties | undefined;
  // Trailing content after the label (a badge, an inline note). Rendered
  // inside the same container so it stays on the checkbox's line.
  children?: React.ReactNode;
}

/**
 * One checkbox row: a marine-sized checkbox, a clickable label, and optional
 * trailing content, all inside a configurable container. Shared by the
 * notifications toggles, the marine toggle, and the merge composition rows so
 * the id-to-label wiring, the 22px hit area, and the disabled-label readability
 * live in one place.
 */
export default function CheckboxRow({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  variant = 'normal',
  visuallyHiddenSuffix,
  describedBy,
  containerStyle = S.checkboxRow,
  children,
}: Props): React.ReactElement {
  return (
    <div style={containerStyle}>
      <input
        id={id}
        type="checkbox"
        style={S.checkbox}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} style={LABEL_STYLE[variant]}>
        {label}
        {visuallyHiddenSuffix ? <span style={S.visuallyHidden}>{visuallyHiddenSuffix}</span> : null}
      </label>
      {children}
    </div>
  );
}
