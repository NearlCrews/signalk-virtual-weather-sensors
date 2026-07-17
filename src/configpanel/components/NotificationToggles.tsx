import type * as React from 'react';
import { Checkbox, FieldGroup, Stack } from 'signalk-nearlcrews-ui';
import {
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
} from '../../constants/notifications-shared.js';
import type { NotificationsFormState } from '../hooks/usePanelConfig.js';

interface Props {
  notifications: NotificationsFormState;
  onChange: (key: keyof NotificationsFormState, value: boolean) => void;
}

export default function NotificationToggles({
  notifications,
  onChange,
}: Props): React.ReactElement {
  return (
    <Stack gap={4}>
      <Checkbox
        id="svws-notif-enabled"
        label={NOTIFICATION_MASTER_LABEL}
        checked={notifications.enabled}
        onChange={(event) => onChange('enabled', event.target.checked)}
      />

      <FieldGroup legend="Alert categories" disabled={!notifications.enabled}>
        <Stack gap={2}>
          {NOTIFICATION_BAND_KEYS.map((key) => (
            <Checkbox
              key={key}
              id={`svws-notif-${key}`}
              label={NOTIFICATION_LABELS[key]}
              checked={notifications[key]}
              onChange={(event) => onChange(key, event.target.checked)}
            />
          ))}
        </Stack>
      </FieldGroup>
    </Stack>
  );
}
