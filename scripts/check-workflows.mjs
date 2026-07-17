import { readFile } from 'node:fs/promises';

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/plugin-ci.yml',
  '.github/workflows/publish.yml',
];
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
if (!ci.includes('node-version: 20.18.0') || !ci.includes('npm run build')) {
  failures.push('ci.yml must retain a blocking Node 20.18 build and test lane.');
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
  'actions/upload-artifact@',
  'actions/download-artifact@',
  'npm pack --json --ignore-scripts',
  'npm publish ./artifacts/*.tgz --provenance --access public',
]) {
  if (!publish.includes(expected)) failures.push(`publish.yml must include ${expected}.`);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  'Workflow pins, compatibility lanes, integration coverage, and publish handoff passed.'
);
