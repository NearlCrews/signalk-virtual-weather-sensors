import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_WEATHER_MODE,
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
} from '../../constants/notifications-shared.js';
import { pluginSchema, pluginUiSchema } from '../../plugin/schema.js';

type BandToggle = { type: 'boolean'; title: string; default: boolean };
type SchemaNotificationsProps = { enabled: BandToggle } & Record<string, BandToggle>;
type EnumProp = { type: 'string'; enum: string[]; enumNames: string[]; default: string };
type PluginSchemaShape = {
  properties: {
    weatherMode: EnumProp;
    notifications: { properties: SchemaNotificationsProps };
  };
};
type UiSchemaShape = {
  'ui:order': string[];
  accuWeatherApiKey: { 'ui:widget': string };
  notifications: { 'ui:order': string[] };
};

describe('generated notifications schema', () => {
  it('lists the master toggle plus every band with the shared labels and defaults', () => {
    const props = (pluginSchema() as PluginSchemaShape).properties.notifications.properties;
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
    const order = (pluginUiSchema() as UiSchemaShape).notifications['ui:order'];
    expect(order).toEqual(['enabled', ...NOTIFICATION_BAND_KEYS]);
  });
  it('keeps the top-level field order and the password widget on the key', () => {
    const ui = pluginUiSchema() as UiSchemaShape;
    expect(ui['ui:order'][0]).toBe('weatherProvider');
    expect(ui.accuWeatherApiKey['ui:widget']).toBe('password');
  });
  it('exposes the weatherMode picker with both modes and the single default', () => {
    const mode = (pluginSchema() as PluginSchemaShape).properties.weatherMode;
    expect(mode.type).toBe('string');
    expect(mode.enum).toEqual(['single', 'merged']);
    expect(mode.default).toBe('single');
    expect(DEFAULT_WEATHER_MODE).toBe('single');
  });
});
