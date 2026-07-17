import { readFile } from 'node:fs/promises';

if (process.env.SVWS_RELEASE_APPROVED !== 'true') {
  throw new Error(
    'Set SVWS_RELEASE_APPROVED=true only after explicit final approval to create the release and publish it.'
  );
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.private === true) throw new Error('A private package cannot be published.');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error(`package.json has invalid release version ${packageJson.version}.`);
}

console.log(`Release ${packageJson.version} has explicit publication approval.`);
