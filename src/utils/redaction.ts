const SENSITIVE_KEY_PATTERN = /apikey|api_key|password|secret|token/i;
const MAX_DEPTH = 5;

function replaceLiteral(value: string, secret: string): string {
  return secret.length >= 4 ? value.split(secret).join('[REDACTED]') : value;
}

/** Redact credentials, sensitive query values, control characters, and known secret literals. */
export function redactSensitiveText(value: string, secrets: Iterable<string> = []): string {
  let redacted = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: log and banner injection defense
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/([?&](?:apikey|api_key|password|secret|token)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/:\/\/[^/@\s]+:[^/@\s]+@/g, '://[REDACTED]@');
  for (const secret of secrets) redacted = replaceLiteral(redacted, secret);
  return redacted;
}

/** Recursively redact structured data for every log level. */
export function redactSensitiveValue(
  value: unknown,
  secrets: Iterable<string> = [],
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (typeof value === 'string') return redactSensitiveText(value, secrets);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[depth-truncated]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, secrets, depth + 1, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : redactSensitiveValue(entry, secrets, depth + 1, seen);
  }
  return result;
}
