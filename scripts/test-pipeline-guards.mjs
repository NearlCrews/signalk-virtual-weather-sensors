import assert from 'node:assert/strict';
import {
  findMissingPlaywrightEngines,
  findRelativeReadmeLinks,
  findStrictVersionShares,
  playwrightEngines,
  playwrightSuiteScripts,
  reachableScripts,
  workflowScripts,
} from './pipeline-guards.mjs';

const targets = (markdown) => findRelativeReadmeLinks(markdown).map(({ target }) => target);

// README links: the App Store renders link targets unmodified, so only
// absolute web, mail, and same-page targets survive there.
assert.deepEqual(
  targets(
    [
      '[site](https://example.com) [plain](http://example.com) [mail](mailto:a@example.com)',
      '[anchor](#requirements) [autolink style](<https://example.com/a b>)',
      '[![badge](https://img.shields.io/x.svg)](https://www.npmjs.com/package/x)',
    ].join('\n')
  ),
  [],
  'absolute, mail, anchor, and badge links pass'
);
assert.deepEqual(
  findRelativeReadmeLinks('Intro\n\nSee the [guide](docs/guide.md "Guide").'),
  [{ line: 3, target: 'docs/guide.md' }],
  'an inline relative link fails with its line'
);
assert.deepEqual(
  targets('[changelog](CHANGELOG.md#v1140) [up](../LICENSE) [root](/docs) [blank]()'),
  ['CHANGELOG.md#v1140', '../LICENSE', '/docs', ''],
  'file anchors, parent paths, root paths, and empty targets fail'
);
assert.deepEqual(
  findRelativeReadmeLinks('[split\nlink text](docs/x.md)'),
  [{ line: 1, target: 'docs/x.md' }],
  'link text that wraps a line still reports where the link starts'
);
assert.deepEqual(
  targets('[license]: LICENSE\n   [site]: https://example.com\n[docs]: <docs/a.md>'),
  ['LICENSE', 'docs/a.md'],
  'reference definitions are checked'
);
assert.deepEqual(
  targets('<a href="docs/a.md">a</a> <a class="x" href=\'#top\'>b</a> <A HREF=LICENSE>c</A>'),
  ['docs/a.md', 'LICENSE'],
  'HTML anchors are checked in every quoting style'
);
assert.deepEqual(
  targets(
    [
      '![hero](assets/hero.png) <img src="assets/icon.png" alt="icon">',
      '[![local badge](assets/badge.svg)](https://example.com)',
      '`[code](docs/a.md)`',
      '<!-- [hidden](docs/a.md) -->',
      '```md',
      '[fenced](docs/a.md)',
      '```',
    ].join('\n')
  ),
  [],
  'images, inline code, comments, and fenced code are ignored'
);

// Federation shares: any strict share keeps the panel off a compatible host.
assert.deepEqual(
  findStrictVersionShares({
    react: { singleton: true, requiredVersion: '^19.2.0', import: false },
    'react-dom': { singleton: true, strictVersion: false },
  }),
  [],
  'non-strict and explicitly relaxed shares pass'
);
assert.deepEqual(
  findStrictVersionShares({
    react: { singleton: true, strictVersion: true },
    'react-dom': { singleton: true },
    lodash: { strictVersion: true },
  }),
  ['react', 'lodash'],
  'every strict share is reported, not only React'
);
assert.deepEqual(
  findStrictVersionShares(['react', { 'react-dom': { strictVersion: true } }]),
  ['react-dom'],
  'the array form is checked'
);
assert.deepEqual(findStrictVersionShares(undefined), [], 'no shared map has no strict share');

// Playwright: engines come from the config, so adding a project adds an engine.
const config = {
  projects: [
    { name: 'chromium', use: { defaultBrowserType: 'chromium' } },
    { name: 'firefox', use: { defaultBrowserType: 'firefox' } },
    { name: 'mobile', use: { defaultBrowserType: 'chromium' } },
    { name: 'safari', use: { browserName: 'webkit', defaultBrowserType: 'chromium' } },
  ],
};
assert.deepEqual(playwrightEngines(config), ['chromium', 'firefox', 'webkit']);
assert.deepEqual(playwrightEngines({}), ['chromium'], 'no projects means the default engine');

const scripts = {
  build: 'node build.mjs',
  'test:browser:built': 'playwright test --project=chromium',
  'test:browser:cross:built': 'node scripts/run-browser-matrix.mjs',
  verify: 'npm run build',
  'verify:browser': 'npm run verify && npm run test:browser:built',
  'verify:release': 'npm run verify && npm run test:browser:cross:built',
  loop: 'npm run loop',
};
assert.deepEqual(
  [...reachableScripts(scripts, 'verify:release')].sort(),
  ['build', 'test:browser:cross:built', 'verify', 'verify:release'],
  'reachable scripts follow npm run chains'
);
assert.deepEqual([...reachableScripts(scripts, 'loop')], ['loop'], 'a cycle ends');
assert.deepEqual([...reachableScripts(scripts, 'missing')], [], 'an absent script reaches nothing');
const suites = playwrightSuiteScripts(scripts);
assert.deepEqual(suites, [
  'test:browser:built',
  'test:browser:cross:built',
  'verify:browser',
  'verify:release',
]);

assert.deepEqual(
  workflowScripts(
    '- run: npm run build\n- run: npx --yes npm@12.0.2 run verify:release\n- run: npm ci'
  ),
  ['build', 'verify:release'],
  'workflow scripts are read with or without a pinned npm'
);

const engines = ['chromium', 'firefox', 'webkit'];
assert.deepEqual(
  findMissingPlaywrightEngines('- run: npx --yes npm@12.0.2 run verify', engines, suites),
  [],
  'a workflow without a browser suite needs no browsers'
);
assert.deepEqual(
  findMissingPlaywrightEngines(
    '- run: npx playwright install --with-deps chromium firefox webkit\n- run: npm run verify:release',
    engines,
    suites
  ),
  [],
  'installing every engine passes'
);
assert.deepEqual(
  findMissingPlaywrightEngines(
    '- run: npx playwright install --with-deps chromium\n- run: npx --yes npm@12.0.2 run verify:release',
    engines,
    suites
  ),
  ['firefox', 'webkit'],
  'a missing engine fails'
);
assert.deepEqual(
  findMissingPlaywrightEngines('- run: npx playwright test', engines, suites),
  engines,
  'a direct Playwright run with no install fails'
);
assert.deepEqual(
  findMissingPlaywrightEngines(
    '- run: npx playwright install --with-deps\n- run: npm run verify:browser',
    engines,
    suites
  ),
  [],
  'a bare install installs every default engine'
);

process.stdout.write('Pipeline guard tests passed.\n');
