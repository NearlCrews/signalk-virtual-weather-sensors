import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { PluginConfiguration } from '../../src/types/config.js';

declare const __REMOTE_URL__: string;

interface PanelProps {
  configuration?: Partial<PluginConfiguration> | null;
  save: (configuration: PluginConfiguration) => void;
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
  readonly 'react-dom': Record<
    string,
    {
      readonly eager: boolean;
      readonly from: string;
      readonly get: () => Promise<() => typeof ReactDOM>;
      readonly loaded: boolean;
    }
  >;
}

const parameters = new URLSearchParams(window.location.search);
const unconfigured = parameters.has('unconfigured');
const failStatusAfterFirst = parameters.has('status-fails-after-first');
const failFirstSave = parameters.has('save-failure');
const slowTestKey = parameters.has('slow-test-key');
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

window.fetch = async (input, init): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.origin);
  if (url.pathname.endsWith('/status')) {
    const requestCount = Number(document.body.dataset.statusRequestCount ?? 0) + 1;
    document.body.dataset.statusRequestCount = String(requestCount);
    // React StrictMode intentionally mounts, cleans up, and remounts the status
    // hook. The first response belongs to the canceled probe, and the second is
    // the first usable snapshot. Fail later polls so stale-state behavior can
    // be exercised without making initialization unknown.
    if (failStatusAfterFirst && requestCount > 2) {
      return jsonResponse({ error: 'fixture status failure' }, 503);
    }
    return jsonResponse(status);
  }
  if (url.pathname.endsWith('/test-key')) {
    document.body.dataset.keyTestCount = String(
      Number(document.body.dataset.keyTestCount ?? 0) + 1
    );
    // Settles only when the caller aborts, so a test can collapse the section
    // while the request is in flight and check that reopening it leaves the
    // field usable rather than stranded in its testing state.
    if (slowTestKey) {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
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
  'react-dom': {
    [ReactDOM.version]: {
      eager: true,
      from: 'virtual-weather-sensors-browser-fixture',
      get: () => Promise.resolve(() => ReactDOM),
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
    futureBand: true,
  },
  futureFixtureSetting: { enabled: true },
} as PluginConfiguration;

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
    const saveAttempts = React.useRef(0);

    const save = (nextConfiguration: PluginConfiguration): void => {
      saveAttempts.current += 1;
      document.body.dataset.saveAttemptCount = String(saveAttempts.current);
      if (failFirstSave && saveAttempts.current === 1) {
        throw new Error('fixture save request failed');
      }
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
  const errorElement = document.querySelector<HTMLElement>('#fixture-error');
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = message;
  }
  document.body.dataset.fixtureReady = 'false';
}
