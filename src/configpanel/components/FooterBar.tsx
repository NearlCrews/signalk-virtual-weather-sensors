import type * as React from 'react';
import type { SaveAction } from '../hooks/usePanelConfig.js';
import { S } from '../styles.js';

interface Props {
  dirty: boolean;
  saving: boolean;
  // Save outcome line (success or failure), persistent until the next save
  // or discard. Null before the first save attempt.
  action: SaveAction | null;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * Sticky action bar pinned to the bottom of the panel: Save, Discard, the
 * "Unsaved changes" indicator, and the save-outcome status line. Save and
 * Discard disable themselves while the form is clean or a save is in flight.
 */
export default function FooterBar({
  dirty,
  saving,
  action,
  onSave,
  onDiscard,
}: Props): React.ReactElement {
  return (
    <div style={S.footer}>
      <button type="button" style={S.btnPrimary} onClick={onSave} disabled={!dirty || saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button type="button" style={S.btnSecondary} onClick={onDiscard} disabled={!dirty || saving}>
        Discard
      </button>
      {dirty && !saving ? <span style={S.dirty}>Unsaved changes</span> : null}
      <span role="status" style={action?.isError ? S.actionErr : S.actionOk}>
        {action ? action.message : ''}
      </span>
    </div>
  );
}
