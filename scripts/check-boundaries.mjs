import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const sourceRoot = resolve('src');
const sourceFiles = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(path);
  }
}

await collect(sourceRoot);
const sourceFileSet = new Set(sourceFiles);
const edges = new Map();

function repositoryPath(path) {
  return relative(process.cwd(), path).split(sep).join('/');
}

function resolveSourceImport(from, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const candidate = resolve(dirname(from), specifier);
  const bases = candidate.endsWith('.js') ? [candidate.slice(0, -3)] : [candidate];
  for (const base of bases) {
    for (const path of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
      if (sourceFileSet.has(path)) return path;
    }
  }
  return undefined;
}

function importSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [
    /(?:import|export)(?:\s+type)?[^;]*?\sfrom\s*['"]([^'"]+)['"]/gs,
    /import\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

for (const file of sourceFiles) {
  const imports = importSpecifiers(await readFile(file, 'utf8'));
  edges.set(file, imports.map((specifier) => resolveSourceImport(file, specifier)).filter(Boolean));
}

const failures = [];
const serverRuntimePattern =
  /^src\/(?:index\.ts|calculators|mappers|notifications|plugin|providers|services)(?:\/|$)/;
for (const [from, targets] of edges) {
  const fromPath = repositoryPath(from);
  for (const target of targets) {
    const targetPath = repositoryPath(target);
    if (!fromPath.startsWith('src/configpanel/') && targetPath.startsWith('src/configpanel/')) {
      failures.push(`${fromPath} imports browser-only panel module ${targetPath}.`);
    }
    if (fromPath.startsWith('src/configpanel/') && serverRuntimePattern.test(targetPath)) {
      failures.push(`${fromPath} imports Node-only runtime module ${targetPath}.`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
function visit(file, path) {
  if (visiting.has(file)) {
    const cycleStart = path.indexOf(file);
    failures.push(
      `Circular dependency: ${[...path.slice(cycleStart), file].map(repositoryPath).join(' -> ')}.`
    );
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of edges.get(file) ?? []) visit(target, [...path, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of sourceFiles) visit(file, []);

if (failures.length > 0) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}

console.log(`Boundaries passed for ${sourceFiles.length} TypeScript modules with no cycles.`);
