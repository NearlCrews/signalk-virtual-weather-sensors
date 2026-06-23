import type * as React from 'react';
// Rendering order comes from NOTIFICATION_LABELS property declaration order
// (via NOTIFICATION_BAND_KEYS); keep that aligned with the rjsf schema's
// notifications.properties order in src/index.ts so the federated panel and
// the fallback form match.
import {
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
} from '../../constants/notifications-shared.js';
import type { NotificationsFormState } from '../hooks/usePanelConfig.js';
import { S } from '../styles.js';

interface Props {
  notifications: NotificationsFormState;
  onChange: (key: keyof NotificationsFormState, value: boolean) => void;
}

/**
 * Master toggle gating the per-band sub-toggles, so an "all on / all off"
 * flick is one click without losing per-category granularity.
 */
export default function NotificationToggles({
  notifications,
  onChange,
}: Props): React.ReactElement {
  return (
    <>
      <div style={S.checkboxRow}>
        <input
          id="svws-notif-enabled"
          type="checkbox"
          style={S.checkbox}
          checked={notifications.enabled}
          onChange={(e) => onChange('enabled', e.target.checked)}
        />
        <label htmlFor="svws-notif-enabled" style={S.checkboxLabelStrong}>
          {NOTIFICATION_MASTER_LABEL}
        </label>
      </div>

      <fieldset style={S.fieldset} disabled={!notifications.enabled}>
        <legend style={S.legend}>Alert categories</legend>
        {NOTIFICATION_BAND_KEYS.map((key) => (
          <div key={key} style={S.checkboxRow}>
            <input
              id={`svws-notif-${key}`}
              type="checkbox"
              style={S.checkbox}
              checked={notifications[key]}
              onChange={(e) => onChange(key, e.target.checked)}
            />
            <label
              htmlFor={`svws-notif-${key}`}
              // The faint token, not stacked opacity: disabled labels must
              // stay readable (AA in every palette).
              style={notifications.enabled ? S.checkboxLabel : S.checkboxLabelDisabled}
            >
              {NOTIFICATION_LABELS[key]}
            </label>
          </div>
        ))}
      </fieldset>
    </>
  );
}
