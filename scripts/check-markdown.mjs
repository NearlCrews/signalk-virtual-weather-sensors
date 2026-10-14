import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, readConfig } from 'markdownlint/promise';

// Lints the maintained Markdown with the markdownlint library, called
// directly. Its command-line wrapper exists to expand globs, and its glob
// stack carried an advisory with no fixed release. The scope needs no glob:
// the root guides, the .github guides, and the guides in docs/, docs/decisions/,
// and docs/maintainers/. docs/superpowers/ holds dated design memos kept as
// historical records, so it stays out of scope here and for cspell.
const root = fileURLToPath(new URL('..', import.meta.url));
const directories = ['.', '.github', 'docs', 'docs/decisions', 'docs/maintainers'];

const files = directories
  .flatMap((directory) =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
  )
  .sort();

const config = await readConfig(join(root, '.markdownlint.json'));
const results = await lint({ config, files: files.map((path) => join(root, path)) });
const failures = files.flatMap((path) =>
  results[join(root, path)]
    .toSorted((left, right) => left.lineNumber - right.lineNumber)
    .map((issue) => {
      const detail = issue.errorDetail ?? issue.errorContext;
      return `${path}:${issue.lineNumber}: ${issue.ruleNames.join('/')} ${issue.ruleDescription}${detail ? ` [${detail}]` : ''}`;
    })
);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Markdown lint passed for ${files.length} files.`);
