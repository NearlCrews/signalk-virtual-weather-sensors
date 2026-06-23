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
import CheckboxRow from './CheckboxRow.js';

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
      <CheckboxRow
        id="svws-notif-enabled"
        label={NOTIFICATION_MASTER_LABEL}
        checked={notifications.enabled}
        variant="strong"
        onChange={(checked) => onChange('enabled', checked)}
      />

      <fieldset style={S.fieldset} disabled={!notifications.enabled}>
        <legend style={S.legend}>Alert categories</legend>
        {NOTIFICATION_BAND_KEYS.map((key) => (
          <CheckboxRow
            key={key}
            id={`svws-notif-${key}`}
            label={NOTIFICATION_LABELS[key]}
            checked={notifications[key]}
            // The faint token, not stacked opacity: disabled labels must stay
            // readable (AA in every palette) while the master toggle is off.
            variant={notifications.enabled ? 'normal' : 'disabled'}
            onChange={(checked) => onChange(key, checked)}
          />
        ))}
      </fieldset>
    </>
  );
}
