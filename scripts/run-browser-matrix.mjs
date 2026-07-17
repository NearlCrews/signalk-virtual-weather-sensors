import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const supportedProjects = ['chromium', 'firefox', 'webkit', 'mobile-chromium'];
const requestedProjects = process.argv.slice(2);
const projects = requestedProjects.length > 0 ? requestedProjects : supportedProjects;

for (const project of projects) {
  if (!supportedProjects.includes(project)) {
    throw new Error(
      `Unknown browser project ${project}. Expected one of: ${supportedProjects.join(', ')}.`
    );
  }
}

const playwrightCli = fileURLToPath(
  new URL('../node_modules/@playwright/test/cli.js', import.meta.url)
);
for (const project of projects) {
  const result = spawnSync(process.execPath, [playwrightCli, 'test', `--project=${project}`], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
