import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  LabeledField,
  LiveRegion,
  Stack,
  StatusIndicator,
  splitLabeledFieldControlProps,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import { SecretInput } from 'signalk-nearlcrews-ui/forms';
import {
  API_KEY_MIN_LENGTH,
  validateApiKeyCandidate,
} from '../../constants/notifications-shared.js';
import { asJsonObject, fetchJson, toErrorText } from '../api-base.js';

interface TestState {
  state: null | 'pending' | 'ok' | 'error';
  message: string;
}

/**
 * The no-result state, as one shared reference. Every keystroke clears the
 * test result, and React bails out of the re-render only when the new state is
 * the SAME object, so allocating a fresh idle literal per character would
 * re-render the field on every key with nothing to show for it.
 */
const IDLE_TEST_STATE: TestState = { state: null, message: '' };

interface Props {
  value: string;
  keyError: string | null;
  /** Reaches the key input, so a save blocked on the key can focus it. */
  inputRef: React.Ref<HTMLInputElement>;
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

export default function ApiKeyField({
  value,
  keyError,
  inputRef,
  onChange,
}: Props): React.ReactElement {
  const [testKey, setTestKey] = useState<TestState>(IDLE_TEST_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  // The owning CollapsibleSection retains this field, so collapsing it hides
  // the subtree with React Activity and runs this cleanup while the component
  // stays mounted. Clearing the result alongside the abort stops a reopened
  // section from sitting on a "Testing" state whose request was cancelled,
  // which would leave the Test button permanently loading.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      setTestKey(IDLE_TEST_STATE);
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
  const pending = testKey.state === 'pending';
  // A failed test reads as the field error above; the in-progress and passing
  // results are status, not validation, so they get their own line.
  const result = pending || testKey.state === 'ok' ? testKey : null;

  return (
    <Stack gap={2}>
      <LabeledField
        label="API key"
        description={
          <>
            Get a key at{' '}
            <a href="https://developer.accuweather.com/" target="_blank" rel="noreferrer">
              developer.accuweather.com
              <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
            </a>
            . Minimum {API_KEY_MIN_LENGTH} characters. Each Test spends one AccuWeather API call.
          </>
        }
        error={error}
        errorLive="polite"
      >
        {(field) => {
          const { controlProps, descriptionId } = splitLabeledFieldControlProps(field);
          return (
            <SecretInput
              {...controlProps}
              ref={inputRef}
              monospace
              placeholder="Paste your AccuWeather developer API key"
              value={value}
              onChange={(event) => {
                controllerRef.current?.abort();
                onChange(event.target.value);
                setTestKey(IDLE_TEST_STATE);
              }}
              trailingContent={
                <Button
                  size="compact"
                  aria-label="Test API key"
                  aria-describedby={descriptionId}
                  loading={pending}
                  loadingLabel="Testing"
                  onClick={() => void doTestKey()}
                >
                  Test
                </Button>
              }
            />
          );
        }}
      </LabeledField>
      {result ? (
        <StatusIndicator tone={result.state === 'ok' ? 'success' : 'info'}>
          {result.message}
        </StatusIndicator>
      ) : null}
      {/*
       * The announcer is always mounted and only its text changes. `live` on
       * the StatusIndicator above would have put `role` and `aria-live` on the
       * element that carries the text, so the region and its content would be
       * created in one commit: screen readers only observe a region that
       * already existed, and the result of a key test, which spends a real
       * AccuWeather API call, might never be announced.
       */}
      <LiveRegion message={result?.message ?? ''} />
    </Stack>
  );
}
