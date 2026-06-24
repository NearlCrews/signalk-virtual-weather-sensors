import type * as React from 'react';
import type { SaveAction } from '../hooks/usePanelConfig.js';
import { S } from '../styles.js';

interface Props {
  dirty: boolean;
  saving: boolean;
  // True when the plugin has never been configured (configuration prop is
  // null/undefined). Save stays enabled so the user can persist defaults to
  // enable the plugin without making a throwaway edit first.
  unconfigured: boolean;
  // Save outcome line (success or failure), persistent until the next save
  // or discard. Null before the first save attempt.
  action: SaveAction | null;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * Sticky action bar pinned to the bottom of the panel: Save, Discard, the
 * "Unsaved changes" indicator, and the save-outcome status line. Save and
 * Discard disable themselves while the form is clean or a save is in flight,
 * except when the plugin is unconfigured: then Save stays enabled so the
 * user can save defaults to enable the plugin.
 */
export default function FooterBar({
  dirty,
  saving,
  unconfigured,
  action,
  onSave,
  onDiscard,
}: Props): React.ReactElement {
  return (
    <div style={S.footer}>
      <button
        type="button"
        style={S.btnPrimary}
        onClick={onSave}
        disabled={saving || (!dirty && !unconfigured)}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button type="button" style={S.btnSecondary} onClick={onDiscard} disabled={!dirty || saving}>
        Discard
      </button>
      {dirty && !saving ? <span style={S.dirty}>Unsaved changes</span> : null}
      {unconfigured && !dirty && !saving ? (
        <span style={S.actionOk}>Save to enable the plugin.</span>
      ) : null}
      <span role="status" style={action?.isError ? S.actionErr : S.actionOk}>
        {action ? action.message : ''}
      </span>
    </div>
  );
}
