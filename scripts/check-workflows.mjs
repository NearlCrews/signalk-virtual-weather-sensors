import { readdir, readFile } from 'node:fs/promises';

const workflowDirectory = '.github/workflows';
const workflowPaths = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => `${workflowDirectory}/${name}`);
const failures = [];

for (const path of workflowPaths) {
  const workflow = await readFile(path, 'utf8');
  for (const [index, line] of workflow.split('\n').entries()) {
    const action = /\buses:\s+([^\s#]+)@([^\s#]+)/.exec(line);
    if (action && !/^[0-9a-f]{40}$/.test(action[2] ?? '')) {
      failures.push(`${path}:${index + 1} must pin ${action[1]} to a full commit SHA.`);
    }
  }
}

const ci = await readFile('.github/workflows/ci.yml', 'utf8');
for (const expected of ['node-version: 20.18.0', 'run type-check', 'run build']) {
  if (!ci.includes(expected)) {
    failures.push(`The blocking Node 20.18 lane in ci.yml must retain ${expected}.`);
  }
}
if (!ci.includes('npm@11.19.0')) {
  failures.push('The Node 20.18 compatibility lane must use its latest supported npm 11 release.');
}
if (!ci.includes('node-version: 24.19.0') || !ci.includes('npx --yes npm@12.0.2')) {
  failures.push('ci.yml must retain Node 24.19.0 and npm 12.0.2 for the full verification lane.');
}

const pluginCi = await readFile('.github/workflows/plugin-ci.yml', 'utf8');
for (const expected of [
  'enable-signalk-integration: true',
  'signalk-server-versions:',
  'enable-armv7: true',
]) {
  if (!pluginCi.includes(expected)) failures.push(`plugin-ci.yml must include ${expected}.`);
}

const publish = await readFile('.github/workflows/publish.yml', 'utf8');
for (const expected of [
  'npm@12.0.2',
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

const workflowSecurity = await readFile('.github/workflows/workflow-security.yml', 'utf8');
for (const expected of ['actionlint@v1.7.12', 'zizmor-action@']) {
  if (!workflowSecurity.includes(expected)) {
    failures.push(`workflow-security.yml must include ${expected}.`);
  }
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  'Workflow pins, compatibility lanes, integration coverage, security, and publish handoff passed.'
);
