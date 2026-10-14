import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  findMissingPlaywrightEngines,
  playwrightEngines,
  playwrightSuiteScripts,
  reachableScripts,
  workflowScripts,
} from './pipeline-guards.mjs';

const workflowDirectory = '.github/workflows';
const workflowNames = (await readdir(workflowDirectory)).filter(
  (name) => name.endsWith('.yml') || name.endsWith('.yaml')
);
const workflows = new Map(
  await Promise.all(
    workflowNames.map(async (name) => [
      name,
      await readFile(`${workflowDirectory}/${name}`, 'utf8'),
    ])
  )
);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const scripts = packageJson.scripts ?? {};
const failures = [];

/** The lines of one top-level block (`on:`) or job (`  name:`), up to the next sibling. */
function block(text, header) {
  const lines = text.split('\n');
  const start = lines.indexOf(header);
  if (start === -1) return '';
  const indent = header.length - header.trimStart().length;
  const end = lines.findIndex(
    (line, index) =>
      index > start && line.trim() !== '' && line.length - line.trimStart().length <= indent
  );
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}
const runsScript = (workflow, name) => workflowScripts(workflow).includes(name);
/** Each job's block, keyed by job id. */
const jobsOf = (workflow) =>
  new Map(
    [...block(workflow, 'jobs:').matchAll(/^ {2}([\w-]+):$/gm)].map(([header, id]) => [
      id,
      block(workflow, header),
    ])
  );
const SCHEDULED_ONLY =
  "if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'";
/** A cron's day-of-week field and its minute of the day, for `M H * * D` schedules. */
const cronTimes = (workflow) =>
  [...workflow.matchAll(/cron:\s*'(\d+) (\d+) \* \* (\S+)'/g)].map(([, minute, hour, day]) => ({
    day,
    minute: Number(hour) * 60 + Number(minute),
  }));

// The plugin registry reads only the newest 20 Actions runs on a published
// commit, and every run on main HEAD can push the plugin-ci run it credits
// out of that window. Adding a workflow adds runs, so the set is pinned.
const expectedWorkflows = [
  'ci.yml',
  'codeql.yml',
  'plugin-ci.yml',
  'publish.yml',
  'workflow-security.yml',
];
if (JSON.stringify([...workflows.keys()].sort()) !== JSON.stringify(expectedWorkflows)) {
  failures.push(
    `Workflows must be exactly ${expectedWorkflows.join(', ')}; fold new scheduled work into an existing workflow.`
  );
}

for (const [name, workflow] of workflows) {
  const path = `${workflowDirectory}/${name}`;
  for (const [index, line] of workflow.split('\n').entries()) {
    const action = /\buses:\s+([^\s#]+)@([^\s#]+)/.exec(line);
    if (action && !/^[0-9a-f]{40}$/.test(action[2] ?? '')) {
      failures.push(`${path}:${index + 1} must pin ${action[1]} to a full commit SHA.`);
    }
  }

  // A newer push supersedes an older run of the same workflow on the same
  // ref. Publishing is the exception: a cancelled publish can leave a release
  // half done, so it never cancels.
  if (name === 'publish.yml') {
    if (!workflow.includes('cancel-in-progress: false')) {
      failures.push(`${path} must never cancel an in-progress publish.`);
    }
  } else if (
    !/^ {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}$/m.test(workflow) ||
    !workflow.includes('cancel-in-progress: true')
  ) {
    failures.push(
      `${path} must declare concurrency group \${{ github.workflow }}-\${{ github.ref }} with cancel-in-progress: true.`
    );
  }

  // The development-tree audit reads an advisory database that changes
  // without a commit, so it never gates a push or a pull request: a job that
  // reaches it in a push or pull-request workflow runs only on a schedule or
  // on dispatch.
  if (/^ {2}(?:push|pull_request):/m.test(block(workflow, 'on:'))) {
    for (const [job, jobBlock] of jobsOf(workflow)) {
      if (jobBlock.includes(SCHEDULED_ONLY)) continue;
      for (const script of workflowScripts(jobBlock)) {
        if (reachableScripts(scripts, script).has('audit:full')) {
          failures.push(
            `${path} job ${job} runs ${script} on push or pull request, which reaches audit:full.`
          );
        }
      }
    }
  }
}

// Every workflow that runs a Playwright suite installs every engine the
// config's projects launch, so adding a project cannot leave CI without it.
const playwrightConfig = (await import(pathToFileURL('playwright.config.ts').href)).default;
const engines = playwrightEngines(playwrightConfig);
const suiteScripts = playwrightSuiteScripts(scripts);
for (const [name, workflow] of workflows) {
  const missing = findMissingPlaywrightEngines(workflow, engines, suiteScripts);
  if (missing.length > 0) {
    failures.push(
      `${workflowDirectory}/${name} runs a Playwright suite without installing ${missing.join(', ')}.`
    );
  }
}

// Script shapes. `verify` is the pre-push gate and the CI gate, so it carries
// the runtime audit the registry scores but no browser suite and no
// development-tree audit; those live in `verify:browser` and `verify:release`.
const verifyRuns = reachableScripts(scripts, 'verify');
if (!verifyRuns.has('audit:runtime')) failures.push('verify must run audit:runtime.');
if (verifyRuns.has('audit:full')) failures.push('verify must not run audit:full.');
if (suiteScripts.includes('verify')) failures.push('verify must not run a browser suite.');
if (!reachableScripts(scripts, 'verify:release').has('audit:full')) {
  failures.push('verify:release must run audit:full.');
}
if (Object.hasOwn(scripts, 'prepare')) {
  failures.push('package.json must not define prepare; hooks are opt-in through npm run hooks.');
}
for (const [hook, gate] of [
  ['pre-commit', 'verify:commit'],
  ['pre-push', 'verify'],
]) {
  const body = await readFile(`.githooks/${hook}`, 'utf8');
  const commands = [...body.matchAll(/^npm run (\S+)\s*$/gm)].map(([, script]) => script);
  if (commands.length !== 1 || commands[0] !== gate) {
    failures.push(`.githooks/${hook} must run npm run ${gate} and nothing else.`);
  }
}

const ci = workflows.get('ci.yml') ?? '';
if (!runsScript(block(ci, '  verify:'), 'verify')) {
  failures.push('The ci.yml verify job must run npm run verify.');
}
if (!ci.includes('node-version: 24.19.0') || !ci.includes('npx --yes npm@12.0.2')) {
  failures.push('ci.yml must retain Node 24.19.0 and npm 12.0.2 for the full verification lane.');
}
// The Node 20.18 lane proves the plugin runtime, not the test toolchain: it
// must keep building AND loading the built plugin there, or the advertised
// floor would be asserted by nothing at all. Node-independent gates run once,
// in the verify lane.
const floorLane = block(ci, '  node-20-compatibility:');
for (const expected of [
  'node-version: 20.18.0',
  'npm@11.19.0 ci',
  'run build',
  'run check:runtime',
  'npm@11.19.0 test',
]) {
  if (!floorLane.includes(expected)) {
    failures.push(`The blocking Node 20.18 lane in ci.yml must retain ${expected}.`);
  }
}
// The Admin job mounts the production panel in a real server. Its oldest
// server is the documented panel floor: the README requires Admin 2.27.0.
const adminJob = block(ci, '  signalk-admin:');
for (const expected of [
  "signalk_server: ['2.27.0', 'latest']",
  '--pack-destination "$RUNNER_TEMP"',
  '--ignore-scripts',
  'scripts/link-signalk-admin.mjs',
  'run test:integration',
]) {
  if (!adminJob.includes(expected)) {
    failures.push(`The ci.yml signalk-admin job must include ${expected}.`);
  }
}

const workflowSecurity = workflows.get('workflow-security.yml') ?? '';
const securityTriggers = block(workflowSecurity, 'on:');
const dependencyAudit = jobsOf(workflowSecurity).get('dependency-audit') ?? '';
if (
  !securityTriggers.includes('schedule:') ||
  !securityTriggers.includes('workflow_dispatch:') ||
  !dependencyAudit.includes(SCHEDULED_ONLY) ||
  !runsScript(dependencyAudit, 'audit:full')
) {
  failures.push(
    'workflow-security.yml must keep a dependency-audit job that runs audit:full only on its schedule and on dispatch.'
  );
}
for (const expected of ['actionlint@v1.7.12', 'zizmor-action@']) {
  if (!workflowSecurity.includes(expected)) {
    failures.push(`workflow-security.yml must include ${expected}.`);
  }
}

const pluginCi = workflows.get('plugin-ci.yml') ?? '';
const pluginCiTriggers = block(pluginCi, 'on:');
for (const expected of ['push:', 'pull_request:', 'schedule:', 'workflow_dispatch:']) {
  if (!pluginCiTriggers.includes(expected)) {
    failures.push(`plugin-ci.yml must trigger on ${expected.slice(0, -1)}.`);
  }
}
// The weekly plugin-ci run comes after every other schedule on the same day,
// so it is the newest run on main HEAD that week.
const [pluginCiCron] = cronTimes(pluginCiTriggers);
const laterSchedules = [...workflows]
  .filter(([name]) => name !== 'plugin-ci.yml')
  .flatMap(([, workflow]) => cronTimes(workflow))
  .filter(({ day, minute }) => day === pluginCiCron?.day && minute >= pluginCiCron.minute);
if (!pluginCiCron || laterSchedules.length > 0) {
  failures.push('plugin-ci.yml must run weekly, later than every other schedule on that day.');
}
// ci.yml runs formatting and coverage once and owns the Admin integration
// job; the release commit's push run, or the weekly run, is what the registry
// credits.
for (const [pattern, reason] of [
  [/^ {4}tags:/m, 'a tag trigger'],
  [/format-check-command:/, 'format-check-command'],
  [/coverage-command:/, 'coverage-command'],
  [/enable-signalk-integration:\s*true/, 'the reusable integration job'],
]) {
  if (pattern.test(pluginCi)) failures.push(`plugin-ci.yml must not enable ${reason}.`);
}

const publish = workflows.get('publish.yml') ?? '';
for (const expected of [
  // The publish lane's Node version is load-bearing, not cosmetic: the
  // `verify:release` step's `test:coverage` goes through
  // `scripts/run-unit-tests.mjs`, and on any Node below the Vitest 5 floor that
  // script prints a notice and exits 0 without running a test. Dropping this
  // lane to Node 20 would publish a release whose unit suite never executed.
  'node-version: 24.19.0',
  'npm@12.0.2',
  // npm skips lifecycle scripts when it publishes a packed tarball, so this
  // explicit step, not `prepublishOnly`, is the release gate.
  'run verify:release',
  'actions/upload-artifact@',
  'actions/download-artifact@',
  '--json --ignore-scripts --pack-destination artifacts',
  'Array.isArray(r)?r[0]:Object.values(r)[0]',
  'publish ./artifacts/*.tgz',
  '--provenance --access public',
  'RELEASE_GIT_HEAD="$(git rev-parse HEAD)"',
  'p.gitHead=process.env.RELEASE_GIT_HEAD',
  'PACKED_GIT_HEAD',
]) {
  if (!publish.includes(expected)) failures.push(`publish.yml must include ${expected}.`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  'Workflow set, pins, concurrency, audit placement, plugin-ci schedule, browser installs, script and hook shapes, compatibility and Admin lanes, and publish handoff passed.'
);
