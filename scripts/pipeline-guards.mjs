// Pure predicates behind the README link, federation share, and Playwright
// install guards. They take parsed inputs and do no I/O, so
// scripts/test-pipeline-guards.mjs can pin each one at its edges.

const SAFE_LINK_TARGET = /^(?:https?:|mailto:|#)/i;

const blank = (text) => text.replace(/[^\n]/g, ' ');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const unwrapTarget = (target) => target.trim().replace(/^<(.*)>$/, '$1');

/**
 * Every link target in a README that the Signal K App Store would render dead.
 * The App Store shows link targets unmodified and rewrites only image paths
 * against the package CDN, so a relative link works on GitHub and npm but not
 * there. Image paths stay allowed; code and HTML comments never render.
 */
export function findRelativeReadmeLinks(markdown) {
  const text = markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/!\[(?:[^[\]]|\[[^[\]]*\])*\]\([^)]*\)/g, blank)
    .replace(/<img\b[^>]*>/gi, blank);
  const findings = [];
  const record = (index, rawTarget) => {
    const target = unwrapTarget(rawTarget);
    if (!SAFE_LINK_TARGET.test(target)) findings.push({ line: lineAt(text, index), target });
  };
  for (const match of text.matchAll(/\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*(<[^>]*>|[^\s)]*)/g)) {
    record(match.index, match[1]);
  }
  for (const match of text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>]*>|\S*)/gm)) {
    record(match.index, match[1]);
  }
  for (const match of text.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    record(match.index, match[1] ?? match[2] ?? match[3]);
  }
  return findings.sort((left, right) => left.line - right.line);
}

/**
 * The share names a Module Federation `shared` option marks `strictVersion`.
 * Signal K 2.24 Admin registers its React share as 19.0.0 while shipping
 * 19.2.4, so a strict share rejects a compatible host and the panel never
 * mounts. Accepts both the object form and the array form webpack allows.
 */
export function findStrictVersionShares(shared) {
  const entries = Array.isArray(shared)
    ? shared.flatMap((item) => (typeof item === 'string' ? [] : Object.entries(item)))
    : Object.entries(shared ?? {});
  return entries
    .filter(([, config]) => typeof config === 'object' && config !== null && config.strictVersion)
    .map(([name]) => name);
}

/** The browser engines a Playwright config's projects launch. */
export function playwrightEngines(config) {
  const projects = config.projects?.length ? config.projects : [{}];
  return [
    ...new Set(
      projects.map(
        (project) =>
          project.use?.browserName ??
          project.use?.defaultBrowserType ??
          config.use?.browserName ??
          'chromium'
      )
    ),
  ].sort();
}

/** Every package script `name` runs, itself included, following `npm run` chains. */
export function reachableScripts(scripts, name) {
  const reached = new Set();
  const visit = (current) => {
    if (reached.has(current) || !Object.hasOwn(scripts, current)) return;
    reached.add(current);
    for (const [, child] of scripts[current].matchAll(/\bnpm\s+run\s+([\w:.-]+)/g)) visit(child);
  };
  visit(name);
  return reached;
}

/**
 * The package scripts that run a Playwright suite, directly or through
 * `npm run`. The cross-browser matrix runner counts because it spawns the
 * Playwright CLI once per project.
 */
export function playwrightSuiteScripts(scripts) {
  const runsSuite = (command) =>
    /\bplaywright\s+test\b|scripts\/run-browser-matrix\.mjs/.test(command);
  return Object.keys(scripts)
    .filter((name) =>
      [...reachableScripts(scripts, name)].some((reached) => runsSuite(scripts[reached]))
    )
    .sort();
}

/** The package scripts a workflow runs through `npm run`, with or without a pinned npm. */
export function workflowScripts(workflow) {
  return [...workflow.matchAll(/\bnpm(?:@[\w.-]+)?\s+run\s+([\w:.-]+)/g)].map(([, name]) => name);
}

/**
 * The engines a workflow runs Playwright suites against but never installs.
 * Empty when the workflow runs no suite. `playwright install` with no engine
 * argument installs every default engine.
 */
export function findMissingPlaywrightEngines(workflow, engines, suiteScripts) {
  const suites = new Set(suiteScripts);
  const runsSuite =
    /\bplaywright\s+test\b/.test(workflow) ||
    workflowScripts(workflow).some((name) => suites.has(name));
  if (!runsSuite) return [];
  const installed = new Set();
  for (const [, args] of workflow.matchAll(/\bplaywright\s+install\b([^\n]*)/g)) {
    const named = args.split(/\s+/).filter((arg) => arg && !arg.startsWith('-'));
    for (const engine of named.length > 0 ? named : engines) installed.add(engine);
  }
  return engines.filter((engine) => !installed.has(engine));
}
