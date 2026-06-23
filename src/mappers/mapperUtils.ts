/**
 * Shared helpers for weather-data mappers.
 *
 * Kept separate from the individual mapper files so helpers with identical
 * logic but different provider names are not copy-pasted per mapper.
 */

import { ERROR_CODES } from '../constants/index.js';
import { asOptionalNumber } from '../utils/conversions.js';

/**
 * Narrow a required numeric field, throwing a tagged error when absent or
 * non-finite. `providerName` appears in the error message so the stack trace
 * identifies which provider produced the malformed response.
 */
export function requireNumber(value: unknown, field: string, providerName: string): number {
  const parsed = asOptionalNumber(value);
  if (parsed === undefined) {
    throw new Error(
      `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: ${providerName} response missing ${field}`
    );
  }
  return parsed;
}
