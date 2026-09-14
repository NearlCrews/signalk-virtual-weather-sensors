/**
 * Whether a Node.js version can run this package's unit-test toolchain.
 *
 * Vitest 5 declares `node: ^22.12.0 || ^24.0.0 || >=26.0.0`, so the unit suite
 * cannot run on the Node 20.18 this plugin advertises in `engines.node`. That
 * floor is a promise about the plugin's own runtime code, not about its test
 * toolchain, and the two are separable: a Signal K plugin runs inside the
 * server process, and `signalk-server` itself declares `node: >=22`, so no
 * supported installation ever executes this plugin on Node 20. The
 * runtime-floor CI lane therefore installs, type-checks, compiles, checks
 * module boundaries, and smoke-loads the built plugin on Node 20.18, and skips
 * the unit suite with a printed notice rather than failing.
 *
 * The floors are spelled out here rather than parsed from Vitest's `engines`
 * string, so the rule stays readable and testable. Bump them when Vitest does,
 * and extend `test-unit-test-toolchain.mjs` with the new boundaries.
 */

/** Lowest Node 22 release Vitest 5 supports. */
const NODE_22_FLOOR = [22, 12, 0];
/**
 * Lowest major that qualifies outright. Vitest's range names 22, 24, and 26
 * and later, so the odd majors 23 and 25 fall in its gaps and never qualify.
 */
const OPEN_ENDED_MAJOR_FLOOR = 26;

function atLeast([major, minor, patch], [floorMajor, floorMinor, floorPatch]) {
  if (major !== floorMajor) return major > floorMajor;
  if (minor !== floorMinor) return minor > floorMinor;
  return patch >= floorPatch;
}

/**
 * True when `version` (a `process.versions.node` string such as `22.12.0`)
 * satisfies Vitest 5's engine range. Anything unparsable is treated as
 * unsupported, so a surprising version string skips the suite loudly rather
 * than crashing inside the runner.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function supportsUnitTestToolchain(version) {
  const parts = version.split('.').map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part))) return false;
  const [major] = parts;
  if (major === 22) return atLeast(parts, NODE_22_FLOOR);
  // Vitest's `^24.0.0` admits the whole major, so no Node 24 release is below
  // a floor; only the 22 range has one.
  if (major === 24) return true;
  return major >= OPEN_ENDED_MAJOR_FLOOR;
}

/** The human-readable floor the skip notice names. */
export const UNIT_TEST_TOOLCHAIN_FLOOR_TEXT = 'Node 22.12 or newer, Node 24, or Node 26 and later';
