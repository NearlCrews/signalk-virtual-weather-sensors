import type { FormatRelativeAgeOptions } from 'signalk-nearlcrews-ui';

/**
 * Shared wording options for every formatRelativeAge call in the panel. The
 * library default is narrow and always numeric, which renders a fresh
 * timestamp as "0 sec. ago"; the family convention is words. Keeping the pair
 * in one constant stops separate call sites from drifting into two wordings.
 */
export const RELATIVE_AGE_FORMAT: FormatRelativeAgeOptions = {
  numeric: 'auto',
  style: 'long',
};
