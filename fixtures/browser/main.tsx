import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginConfiguration } from '../../src/types/config.js';

declare const __REMOTE_URL__: string;

interface PanelProps {
  configuration?: Partial<PluginConfiguration> | null;
  save: (configuration: PluginConfiguration) => unknown;
}

interface RemoteContainer {
  get(module: string): Promise<() => { default: React.ComponentType<PanelProps> }>;
  init(scope: ShareScope): Promise<void> | void;
}

interface ShareScope {
  readonly react: Record<
    string,
    {
      readonly eager: boolean;
      readonly from: string;
      readonly get: () => Promise<() => typeof React>;
      readonly loaded: boolean;
    }
  >;
}

const parameters = new URLSearchParams(window.location.search);
const unconfigured = parameters.has('unconfigured');
if (parameters.has('unsupported-css-scope')) {
  Object.defineProperty(window, 'CSSScopeRule', { configurable: true, value: undefined });
}

const status = {
  running: true,
  banner: 'Running, last update 1 minute ago',
  updates: 12,
  quotaUsedLast24h: 8,
  lastUpdateMinutesAgo: 1,
  activeNotifications: 2,
  weatherProviderRegistered: true,
};

const jsonResponse = (body: unknown, responseStatus = 200): Response =>
  new Response(JSON.stringify(body), {
    status: responseStatus,
    headers: { 'content-type': 'application/json' },
  });

window.fetch = async (input): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.origin);
  if (url.pathname.endsWith('/status')) {
    document.body.dataset.statusRequestCount = String(
      Number(document.body.dataset.statusRequestCount ?? 0) + 1
    );
    return jsonResponse(status);
  }
  if (url.pathname.endsWith('/test-key')) {
    document.body.dataset.keyTestCount = String(
      Number(document.body.dataset.keyTestCount ?? 0) + 1
    );
    return jsonResponse({ ok: true, message: 'API key works.' });
  }
  return jsonResponse({ error: `Unhandled fixture request: ${url.pathname}` }, 404);
};

const shareScope: ShareScope = {
  react: {
    [React.version]: {
      eager: true,
      from: 'virtual-weather-sensors-browser-fixture',
      get: () => Promise.resolve(() => React),
      loaded: true,
    },
  },
};

const initialConfiguration: PluginConfiguration = {
  weatherProvider: parameters.has('screenshot') ? 'accuweather' : 'open-meteo',
  weatherMode: 'single',
  mergeProviders: ['open-meteo', 'met-no', 'accuweather'],
  accuWeatherApiKey: parameters.has('screenshot') ? 'configured-placeholder-key' : '',
  openMeteoBaseUrl: '',
  marineData: false,
  updateFrequency: 30,
  emissionInterval: 5,
  dailyApiQuota: 50,
  notifications: {
    enabled: parameters.has('screenshot'),
    wind: true,
    visibility: true,
    heat: true,
    cold: true,
    weather: true,
  },
};

try {
  const container = (await import(/* @vite-ignore */ __REMOTE_URL__)) as RemoteContainer;
  await container.init(shareScope);
  const factory = await container.get('./PluginConfigurationPanel');
  const Panel = factory().default;
  const rootElement = document.querySelector('#root');
  if (!(rootElement instanceof HTMLElement)) throw new Error('Fixture root is missing.');

  function HostFixture(): React.ReactElement {
    const [configuration, setConfiguration] = React.useState<PluginConfiguration | null>(
      unconfigured ? null : initialConfiguration
    );

    const save = async (nextConfiguration: PluginConfiguration): Promise<void> => {
      document.body.dataset.saveCount = String(Number(document.body.dataset.saveCount ?? 0) + 1);
      document.body.dataset.savedConfiguration = JSON.stringify(nextConfiguration);
      setConfiguration(nextConfiguration);
    };

    return <Panel configuration={configuration} save={save} />;
  }

  createRoot(rootElement).render(
    <React.StrictMode>
      <HostFixture />
    </React.StrictMode>
  );
  document.body.dataset.fixtureReady = 'true';
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const errorElement = document.querySelector('#fixture-error');
  if (errorElement) errorElement.textContent = message;
  document.body.dataset.fixtureReady = 'false';
}
