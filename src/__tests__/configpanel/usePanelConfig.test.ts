import { describe, expect, it } from 'vitest';
import {
  configurationFromForm,
  formStateFromConfig,
} from '../../configpanel/hooks/usePanelConfig.js';
import { createMockConfig } from '../setup.js';

describe('panel configuration serialization', () => {
  it('preserves unknown top-level and nested notification fields', () => {
    const original = {
      ...createMockConfig(),
      futureTopLevelSetting: { enabled: true },
      notifications: {
        ...createMockConfig().notifications,
        futureBand: true,
      },
    };
    const form = {
      ...formStateFromConfig(original),
      updateFrequency: 45,
    };

    expect(configurationFromForm(form, original)).toMatchObject({
      updateFrequency: 45,
      futureTopLevelSetting: { enabled: true },
      notifications: { futureBand: true },
    });
  });

  it('clones form arrays and notification state into the outgoing snapshot', () => {
    const form = formStateFromConfig(createMockConfig());
    const payload = configurationFromForm(form, {});

    expect(payload.mergeProviders).toEqual(form.mergeProviders);
    expect(payload.mergeProviders).not.toBe(form.mergeProviders);
    expect(payload.notifications).toEqual(form.notifications);
    expect(payload.notifications).not.toBe(form.notifications);
  });

  it('ignores array-shaped configuration containers instead of spreading numeric keys', () => {
    const form = formStateFromConfig([]);
    const payload = configurationFromForm(form, { notifications: ['unexpected'] });

    expect(payload).not.toHaveProperty('0');
    expect(payload.notifications).not.toHaveProperty('0');
  });

  it('retains future known-field values during an unrelated edit', () => {
    const original = {
      ...createMockConfig(),
      weatherProvider: 'future-weather',
      weatherMode: 'adaptive',
      mergeProviders: ['open-meteo', 'future-weather'],
      updateFrequency: 120,
    };
    const baseline = formStateFromConfig(original);
    const form = { ...baseline, emissionInterval: baseline.emissionInterval + 1 };

    expect(configurationFromForm(form, original, baseline)).toMatchObject({
      weatherProvider: 'future-weather',
      weatherMode: 'adaptive',
      mergeProviders: ['open-meteo', 'future-weather'],
      updateFrequency: 120,
      emissionInterval: form.emissionInterval,
    });
  });

  it('replaces a future raw value when the operator explicitly edits that field', () => {
    const original = {
      ...createMockConfig(),
      weatherProvider: 'future-weather',
      weatherMode: 'adaptive',
      mergeProviders: ['open-meteo', 'future-weather'],
      updateFrequency: 120,
    };
    const baseline = formStateFromConfig(original);
    const form = {
      ...baseline,
      weatherProvider: 'met-no' as const,
      weatherMode: 'merge' as const,
      mergeProviders: ['met-no' as const],
      updateFrequency: 45,
    };

    expect(configurationFromForm(form, original, baseline)).toMatchObject({
      weatherProvider: 'met-no',
      weatherMode: 'merge',
      mergeProviders: ['met-no'],
      updateFrequency: 45,
    });
  });

  it('uses the last requested payload as the raw baseline for a later request', () => {
    const original = createMockConfig();
    const baseline = formStateFromConfig(original);
    const firstForm = { ...baseline, updateFrequency: 45 };
    const firstPayload = configurationFromForm(firstForm, original, baseline);
    const secondForm = {
      ...firstForm,
      notifications: { ...firstForm.notifications, enabled: true },
    };

    expect(configurationFromForm(secondForm, firstPayload, firstForm)).toMatchObject({
      updateFrequency: 45,
      notifications: { enabled: true },
    });
  });
});
