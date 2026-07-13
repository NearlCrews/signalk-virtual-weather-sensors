import type * as React from 'react';
import { S } from '../styles.js';

interface Props {
  // id of the body element, wired to the header button's aria-controls.
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  // Trailing summary of the section's current values, shown while collapsed
  // so the operator can scan settings without expanding anything.
  summary?: string;
  children: React.ReactNode;
}

/**
 * Collapsible config section. Sections start collapsed so the panel opens as
 * a compact summary under the Status block; the operator expands only what
 * they intend to change. The body stays mounted (hidden while collapsed) so
 * the aria-controls target is always the real element.
 */
export default function Section({
  id,
  title,
  open,
  onToggle,
  summary,
  children,
}: Props): React.ReactElement {
  return (
    <div>
      <button
        type="button"
        className="svws-section-header"
        style={S.sectionHeader}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
      >
        <span
          className="svws-chevron"
          style={{ ...S.chevron, transform: open ? 'rotate(90deg)' : 'none' }}
          aria-hidden="true"
        >
          ▸
        </span>
        {title}
        {!open && summary ? (
          <span className="svws-section-summary" style={S.sectionSummary}>
            {summary}
          </span>
        ) : null}
      </button>
      <div id={id} style={S.sectionBody} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
