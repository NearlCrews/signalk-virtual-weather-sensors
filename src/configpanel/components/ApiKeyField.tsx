import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Cluster, LabeledField } from 'signalk-nearlcrews-ui';
import { SecretInput } from 'signalk-nearlcrews-ui/forms';
import {
  API_KEY_MIN_LENGTH,
  validateApiKeyCandidate,
} from '../../constants/notifications-shared.js';
import { asJsonObject, fetchJson, toErrorText } from '../api-base.js';
import utilities from '../panel-utilities.module.css';
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
  const data = asJsonObject(body);
  const message = typeof data.message === 'string' ? data.message : '';
  return ok && data.ok === true
    ? { state: 'ok', message: message || 'API key works.' }
    : { state: 'error', message: message || `Test failed (HTTP ${status}).` };
}

export default function ApiKeyField({ value, keyError, onChange }: Props): React.ReactElement {
  const [testKey, setTestKey] = useState<TestState>({ state: null, message: '' });
  const controllerRef = useRef<AbortController | null>(null);

  // The owning CollapsibleSection retains this field, so collapsing it hides
  // the subtree with React Activity and runs this cleanup while the component
  // stays mounted. Clearing the result alongside the abort stops a reopened
  // section from sitting on a "Testing" state whose request was cancelled,
  // which would leave the Test button permanently loading.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      setTestKey({ state: null, message: '' });
    },
    []
  );

  const doTestKey = async (): Promise<void> => {
    const trimmed = value.trim();
    const keyFormatError = validateApiKeyCandidate(trimmed);
    if (keyFormatError) {
      setTestKey({ state: 'error', message: keyFormatError });
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
            . Minimum {API_KEY_MIN_LENGTH} characters. Each Test spends one AccuWeather API call.
          </>
        }
        error={error}
        errorLive="polite"
      >
        <SecretInput
          id="svws-apikey"
          className={utilities.identifier}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          placeholder="Paste your AccuWeather developer API key"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            controllerRef.current?.abort();
            onChange(event.target.value);
            setTestKey({ state: null, message: '' });
          }}
        />
      </LabeledField>
      <Cluster justify="between">
        <p
          className={styles.result}
          data-tone={testKey.state === 'ok' ? 'ok' : undefined}
          role="status"
          aria-live="polite"
        >
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
