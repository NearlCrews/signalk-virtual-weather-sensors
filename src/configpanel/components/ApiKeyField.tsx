import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { API_KEY_MIN_LENGTH, validateKeyLength } from '../../constants/notifications-shared.js';
import { fetchJson, toErrorText } from '../api-base.js';
import { S } from '../styles.js';

interface TestState {
  state: null | 'pending' | 'ok' | 'error';
  message: string;
}

interface Props {
  value: string;
  // Inline error from the Save flow's min-length gate, owned by
  // usePanelConfig; cleared there when the key input changes.
  keyError: string | null;
  onChange: (next: string) => void;
}

async function requestKeyTest(apiKey: string, signal: AbortSignal): Promise<TestState> {
  const { ok, status, body } = await fetchJson('/test-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    signal,
  });
  const data = (body ?? {}) as { ok?: boolean; message?: string };
  return ok && data.ok
    ? { state: 'ok', message: data.message || 'API key works.' }
    : { state: 'error', message: data.message || `Test failed (HTTP ${status}).` };
}

/**
 * API key input with an inline Test button. Testing POSTs the candidate key
 * to /api/test-key (one AccuWeather call per click); the result renders in a
 * polite live region and clears the moment the key changes, so a stale "API
 * key works" can never describe a different key.
 */
export default function ApiKeyField({ value, keyError, onChange }: Props): React.ReactElement {
  // `state` is always paired with a `message`, so one object eliminates a
  // class of bugs where the two get out of sync between setters.
  const [testKey, setTestKey] = useState<TestState>({ state: null, message: '' });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    []
  );

  const doTestKey = async (): Promise<void> => {
    const trimmed = value.trim();
    const keyLengthError = validateKeyLength(trimmed);
    if (keyLengthError) {
      setTestKey({ state: 'error', message: keyLengthError });
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setTestKey({ state: 'pending', message: 'Testing key against AccuWeather...' });
    try {
      const result = await requestKeyTest(trimmed, controller.signal);
      if (!controller.signal.aborted) setTestKey(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setTestKey({
        state: 'error',
        message: `Network error: ${toErrorText(err)}`,
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const resultMessage = keyError ?? (testKey.state !== 'pending' ? testKey.message : '');
  const resultIsError = keyError !== null || testKey.state === 'error';

  return (
    <>
      <div style={S.fieldRow}>
        <label style={S.label} htmlFor="svws-apikey">
          API key
        </label>
        <input
          id="svws-apikey"
          type="password"
          autoComplete="off"
          placeholder="paste your AccuWeather developer API key"
          value={value}
          onChange={(e) => {
            controllerRef.current?.abort();
            onChange(e.target.value);
            // A result describes the key it was produced for; a new key
            // invalidates it.
            setTestKey({ state: null, message: '' });
          }}
          style={S.input}
          aria-describedby="svws-apikey-help"
          aria-invalid={resultIsError}
        />
        <button
          type="button"
          style={S.btnSecondary}
          onClick={() => void doTestKey()}
          disabled={testKey.state === 'pending'}
        >
          {testKey.state === 'pending' ? 'Testing...' : 'Test'}
        </button>
      </div>
      {/* Static help, the input's aria-describedby target. It carries no live
          region so the description is announced once on focus, not re-announced
          on every key test. */}
      <p id="svws-apikey-help" style={S.help}>
        Get a key at{' '}
        <a
          style={S.link}
          href="https://developer.accuweather.com/"
          target="_blank"
          rel="noreferrer"
        >
          developer.accuweather.com
        </a>
        . Minimum {API_KEY_MIN_LENGTH} characters.
      </p>
      {/* Separate polite live region for the test result only, always mounted
          so it exists before the first result. Kept out of aria-describedby so
          a key test announces once, not twice. */}
      <p role="status" aria-live="polite" style={resultIsError ? S.testResultErr : S.testResultOk}>
        {resultMessage}
      </p>
    </>
  );
}
