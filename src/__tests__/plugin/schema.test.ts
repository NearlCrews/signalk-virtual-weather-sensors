import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
} from '../../constants/notifications-shared.js';
import { pluginSchema, pluginUiSchema } from '../../plugin/schema.js';

describe('generated notifications schema', () => {
  it('lists the master toggle plus every band with the shared labels and defaults', () => {
    const props = (pluginSchema() as any).properties.notifications.properties;
    expect(Object.keys(props)).toEqual(['enabled', ...NOTIFICATION_BAND_KEYS]);
    expect(props.enabled).toEqual({
      type: 'boolean',
      title: NOTIFICATION_MASTER_LABEL,
      default: DEFAULT_NOTIFICATIONS.enabled,
    });
    for (const key of NOTIFICATION_BAND_KEYS) {
      expect(props[key]).toEqual({
        type: 'boolean',
        title: NOTIFICATION_LABELS[key],
        default: DEFAULT_NOTIFICATIONS[key],
      });
    }
  });
  it('orders the notifications ui by master then bands', () => {
    const order = (pluginUiSchema() as any).notifications['ui:order'];
    expect(order).toEqual(['enabled', ...NOTIFICATION_BAND_KEYS]);
  });
  it('keeps the top-level field order and the password widget on the key', () => {
    const ui = pluginUiSchema() as any;
    expect(ui['ui:order'][0]).toBe('weatherProvider');
    expect(ui.accuWeatherApiKey['ui:widget']).toBe('password');
  });
});
