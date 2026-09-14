import assert from 'node:assert/strict';
import { supportsUnitTestToolchain } from './unit-test-toolchain.mjs';

// Vitest 5 declares `node: ^22.12.0 || ^24.0.0 || >=26.0.0`. The predicate must
// follow that range exactly, including the gaps at Node 23 and Node 25, so the
// runtime-floor lane skips the suite for the real reason rather than by luck.
assert.equal(
  supportsUnitTestToolchain('20.18.0'),
  false,
  'the advertised runtime floor is excluded'
);
assert.equal(
  supportsUnitTestToolchain('20.19.5'),
  false,
  'later Node 20 releases are still excluded'
);
assert.equal(supportsUnitTestToolchain('22.11.9'), false, 'Node 22 below 22.12 is excluded');
assert.equal(supportsUnitTestToolchain('22.12.0'), true, 'Node 22.12.0 is the Node 22 floor');
assert.equal(supportsUnitTestToolchain('22.22.2'), true, 'later Node 22 releases qualify');
assert.equal(supportsUnitTestToolchain('23.11.0'), false, 'Node 23 falls in a gap of the range');
assert.equal(supportsUnitTestToolchain('24.0.0'), true, 'Node 24.0.0 is the Node 24 floor');
assert.equal(supportsUnitTestToolchain('24.15.0'), true, 'later Node 24 releases qualify');
assert.equal(supportsUnitTestToolchain('25.0.0'), false, 'Node 25 falls in the other gap');
assert.equal(supportsUnitTestToolchain('26.0.0'), true, 'Node 26 opens the range again');
assert.equal(supportsUnitTestToolchain('27.4.1'), true, 'every later major qualifies');
assert.equal(
  supportsUnitTestToolchain('22.12'),
  false,
  'a version missing its patch never qualifies'
);
assert.equal(supportsUnitTestToolchain('22.x.0'), false, 'a non-numeric segment never qualifies');
assert.equal(supportsUnitTestToolchain('garbage'), false, 'an unparsable version never qualifies');

process.stdout.write('Unit-test toolchain floor tests passed.\n');
