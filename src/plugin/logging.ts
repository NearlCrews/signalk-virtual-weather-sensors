/** Structured, centrally redacted plugin logger. */
import type { ServerAPI } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import type { Logger, LogLevel } from '../types/index.js';
import { redactSensitiveText, redactSensitiveValue } from '../utils/redaction.js';

const LOG_PREFIX: Record<LogLevel, string> = {
  debug: '[DEBUG] ',
  info: '[INFO] ',
  warn: '[WARN] ',
  error: '[ERROR] ',
};

export function createLogger(app: ServerAPI): Logger {
  const secrets = new Set<string>();
  const logger: Logger = (level, message, metadata) => {
    const safeMessage = redactSensitiveText(message, secrets);
    const safeMetadata =
      metadata === undefined ? undefined : redactSensitiveValue(metadata, secrets);
    const suffix = safeMetadata === undefined ? '' : ` | ${JSON.stringify(safeMetadata)}`;
    const line = `${LOG_PREFIX[level]}[${PLUGIN.NAME}] ${safeMessage}${suffix}`;
    if (level === 'warn' || level === 'error') app.error(line);
    else app.debug(line);
  };
  logger.addSensitiveValue = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length >= 4) secrets.add(trimmed);
  };
  logger.redact = (value: string): string => redactSensitiveText(value, secrets);
  return logger;
}
