import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Cluster, LabeledField, TextInput } from 'signalk-nearlcrews-ui';
import { API_KEY_MIN_LENGTH, validateKeyLength } from '../../constants/notifications-shared.js';
import { fetchJson, toErrorText } from '../api-base.js';
import styles from './ApiKeyField.module.css';

interface TestState {
  state: null | 'pending' | 'ok' | 'error';
  message: string;
}

interface Props {
  value: string;
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

export default function ApiKeyField({ value, keyError, onChange }: Props): React.ReactElement {
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
    } catch (error) {
      if (controller.signal.aborted) return;
      setTestKey({ state: 'error', message: `Network error: ${toErrorText(error)}` });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const error = keyError ?? (testKey.state === 'error' ? testKey.message : null);
  const statusMessage =
    testKey.state === 'pending' || testKey.state === 'ok' ? testKey.message : '';

  return (
    <>
      <LabeledField
        label="API key"
        description={
          <>
            Get a key at{' '}
            <a href="https://developer.accuweather.com/" target="_blank" rel="noreferrer">
              developer.accuweather.com
            </a>
            . Minimum {API_KEY_MIN_LENGTH} characters.
          </>
        }
        error={error}
        errorLive="polite"
      >
        <TextInput
          id="svws-apikey"
          type="password"
          autoComplete="off"
          placeholder="Paste your AccuWeather developer API key"
          value={value}
          onChange={(event) => {
            controllerRef.current?.abort();
            onChange(event.target.value);
            setTestKey({ state: null, message: '' });
          }}
        />
      </LabeledField>
      <Cluster justify="between">
        <p className={styles.result} role="status" aria-live="polite">
          {statusMessage}
        </p>
        <Button
          aria-label="Test API key"
          loading={testKey.state === 'pending'}
          loadingLabel="Testing"
          onClick={() => void doTestKey()}
        >
          Test
        </Button>
      </Cluster>
    </>
  );
}
