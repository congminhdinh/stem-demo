// Writes robot-scenarios.v1.json: the list of the robot scenarios this build ships (N18 R7.1), for the repositories that name a scenario by
// key (STEMLearning: LabTemplateCatalog, appsettings `Robot`, the admin app's picker) and pin themselves to it with a test. For each scenario:
// key, version, title (vi, en), goal ids, maxScore (left out for the sandbox), profile and hasGoals. Deterministic: the scenarios in the order
// of the lessons, the keys of every object sorted, two-space indent, one newline at the end.
//
//   node scripts/export-robot-manifest.mjs [--scenarios <folder>] [--out <file>] [--check]
//   pnpm export:robot-manifest
//
//   --scenarios  the folder of rb-*.json (default src/samples/robot-scenarios, the one the app bundles)
//   --out        the file to write (default docs/fixtures/robot-scenarios.v1.json, the committed copy STEMLearning takes)
//   --check      write nothing; exit 1 when the file is missing or differs from what the scenarios give
//
// Exit codes: 0 written (or up to date with --check); 1 a scenario does not validate, or --check found the file out of date;
// 2 a usage error (an unknown option, a missing folder, a Node that cannot run the sources).
//
// It runs in plain Node, not in Vite: the catalog is built from the files this script reads with `createScenarioCatalog`
// (src/samples/robot-scenarios/index.ts), never with `import.meta.glob`, which only Vite and Vitest have. The sources are TypeScript with
// extensionless imports, which Node runs by type stripping once the hooks below resolve a relative import to its .ts file and give the
// module that defines the app's own catalog a no-op `import.meta.glob`: needs Node 22.15+ (24 in this project).

import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = join(root, 'src');

const write = (stream, text) => stream.write(text + String.fromCharCode(10));
const out = (text) => write(process.stdout, text);
const fail = (code, text) => {
  write(process.stderr, text);
  process.exit(code);
};

// ---- Arguments
const options = { scenarios: join(sourceRoot, 'samples', 'robot-scenarios'), out: join(root, 'docs', 'fixtures', 'robot-scenarios.v1.json'), check: false };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--check') {
    options.check = true;
  } else if (arg === '--scenarios' || arg === '--out') {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(2, `${arg} needs a path.`);
    }
    options[arg.slice(2)] = resolve(value);
    index += 1;
  } else {
    fail(2, `Unknown option ${arg}. Usage: node scripts/export-robot-manifest.mjs [--scenarios <folder>] [--out <file>] [--check]`);
  }
}
if (!existsSync(options.scenarios) || !statSync(options.scenarios).isDirectory()) {
  fail(2, `The scenarios folder ${options.scenarios} does not exist.`);
}

// ---- Run the TypeScript sources: relative imports without an extension resolve to the .ts file (or folder/index.ts) beside them
if (typeof registerHooks !== 'function') {
  fail(2, 'This script needs Node 22.15 or newer (module.registerHooks, and TypeScript type stripping): this is Node ' + process.versions.node + '.');
}
const isFile = (path) => existsSync(path) && statSync(path).isFile();
// index.ts builds the app's catalog from `import.meta.glob(...)` as it loads; Node has no such function, so that one module gets an empty one
// (its `scenarioCatalog` is empty here, and unused: this script builds its own catalog from the files it reads).
const catalogModule = pathToFileURL(join(sourceRoot, 'samples', 'robot-scenarios', 'index.ts')).href;
const noGlob = 'import.meta.glob ??= () => ({});' + String.fromCharCode(10);
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    return url === catalogModule && loaded.source != null ? { ...loaded, source: noGlob + loaded.source.toString() } : loaded;
  },
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && parent !== undefined && parent.startsWith('file:')) {
      const base = fileURLToPath(new URL(specifier, parent));
      if (base.startsWith(sourceRoot) && !isFile(base)) {
        for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
          if (isFile(candidate)) {
            return nextResolve(pathToFileURL(candidate).href, context);
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { createScenarioCatalog } = await import(catalogModule);
const { robotScenarioManifest, serializeManifest } = await import(pathToFileURL(join(sourceRoot, 'samples', 'robot-scenarios', 'manifest.ts')).href);

// ---- Read the scenarios (rb-*.json; anything else in the folder is not a scenario) and build the manifest
const files = {};
for (const name of readdirSync(options.scenarios).filter((entry) => /^rb-.+\.json$/.test(entry)).sort()) {
  const path = join(options.scenarios, name);
  try {
    files[`./${name}`] = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(1, `${name} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// One file at a time first, so that a scenario that does not validate is named by its file
for (const [path, json] of Object.entries(files)) {
  try {
    createScenarioCatalog({ [path]: json });
  } catch (error) {
    fail(1, `${path.slice(2)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const text = serializeManifest(robotScenarioManifest(createScenarioCatalog(files)));

const shown = relative(process.cwd(), options.out) || options.out;
const count = Object.keys(files).length;
if (options.check) {
  const current = isFile(options.out) ? readFileSync(options.out, 'utf8') : null;
  if (current !== text) {
    fail(1, `${shown} is ${current === null ? 'missing' : 'out of date'}: run \`pnpm export:robot-manifest\` and commit the result (${count} scenario file${count === 1 ? '' : 's'}).`);
  }
  out(`${shown} is up to date (${count} scenario file${count === 1 ? '' : 's'}).`);
} else {
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, text);
  out(`${shown}: ${count} scenario file${count === 1 ? '' : 's'}.`);
}
