import type * as React from 'react';
import { useState } from 'react';
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

  const doTestKey = async (): Promise<void> => {
    const trimmed = value.trim();
    const keyLengthError = validateKeyLength(trimmed);
    if (keyLengthError) {
      setTestKey({ state: 'error', message: keyLengthError });
      return;
    }
    setTestKey({ state: 'pending', message: 'Testing key against AccuWeather...' });
    try {
      const { ok, status, body } = await fetchJson('/test-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = (body ?? {}) as { ok?: boolean; message?: string };
      if (ok && data.ok) {
        setTestKey({ state: 'ok', message: data.message || 'API key works.' });
      } else {
        setTestKey({
          state: 'error',
          message: data.message || `Test failed (HTTP ${status}).`,
        });
      }
    } catch (err) {
      setTestKey({
        state: 'error',
        message: `Network error: ${toErrorText(err)}`,
      });
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
            onChange(e.target.value);
            // A result describes the key it was produced for; a new key
            // invalidates it.
            setTestKey({ state: null, message: '' });
          }}
          style={S.input}
          aria-describedby="svws-apikey-result"
          aria-invalid={keyError !== null}
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
      <p style={S.help}>
        Get one free at{' '}
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
      {/* Always mounted so the live region exists before the first result. */}
      <p
        id="svws-apikey-result"
        role="status"
        aria-live="polite"
        style={resultIsError ? S.testResultErr : S.testResultOk}
      >
        {resultMessage}
      </p>
    </>
  );
}
