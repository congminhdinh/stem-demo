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
//   --print-cache-dir  print the directory Vite's dependency cache of this script is resolved to (its own, see below), and exit; it resolves
//                the config only, with no server and no optimizer, and is what tests/export-robot-manifest.test.ts checks the cache against
//
// Exit codes: 0 written (or up to date with --check); 1 a scenario does not validate, or --check found the file out of date;
// 2 a usage error (an unknown option, a missing folder).
//
// The sources are TypeScript with extensionless imports, and src/samples/robot-scenarios/index.ts uses `import.meta.glob`, which only Vite has.
// So the script loads them the way the app does: through Vite's SSR loader (`createServer` in middleware mode, with the repo's
// vite.config.ts, then `ssrLoadModule`), with nothing faked. That works on every Node the project supports (`engines`, Node 20.19 and up).
// The catalog it writes from is built by `createScenarioCatalog` from the files this script reads, never from the glob: the glob's own catalog
// is the app's and is ignored here.
//
// Its Vite server keeps its cache of pre-bundled dependencies in node_modules/.vite-export-robot-manifest and never in node_modules/.vite, which
// belongs to `pnpm dev` and the e2e runs: the repo's config pulls @vitejs/plugin-react in, which adds react to `optimizeDeps.include`, and a
// run under another NODE_ENV (the test run's `test`) hashes the config differently, so the optimizer would rewrite the dev server's cache under
// it and send the next e2e run back to a cold start. (`optimizeDeps.disabled`, which would stop the optimizer altogether, is deprecated:
// `noDiscovery` with an empty `include` is its replacement, and the plugin's own entries still apply on top of it, hence the separate cache.)

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createServer, resolveConfig } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A failure with the exit code it ends the script with. */
class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const plural = (count) => `${count} scenario file${count === 1 ? '' : 's'}`;
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * The Vite config of the script's server: the repo's, with the server of a script (no HMR, no watcher, no WebSocket server: with `hmr: false`
 * alone Vite still opens one on port 24678, so a run next to `pnpm dev` or another script wrote a port error) and a cache of its own (see the
 * header).
 */
const viteOptions = {
  root,
  configFile: join(root, 'vite.config.ts'),
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  cacheDir: join(root, 'node_modules', '.vite-export-robot-manifest'),
  optimizeDeps: { noDiscovery: true, include: [] },
};

function parseArguments(args) {
  const options = {
    scenarios: join(root, 'src', 'samples', 'robot-scenarios'),
    out: join(root, 'docs', 'fixtures', 'robot-scenarios.v1.json'),
    check: false,
    printCacheDir: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--print-cache-dir') {
      options.printCacheDir = true;
    } else if (arg === '--scenarios' || arg === '--out') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Failure(2, `${arg} needs a path.`);
      }
      options[arg.slice(2)] = resolve(value);
      index += 1;
    } else {
      throw new Failure(2, `Unknown option ${arg}. Usage: node scripts/export-robot-manifest.mjs [--scenarios <folder>] [--out <file>] [--check]`);
    }
  }
  if (!existsSync(options.scenarios) || !statSync(options.scenarios).isDirectory()) {
    throw new Failure(2, `The scenarios folder ${options.scenarios} does not exist.`);
  }
  return options;
}

/** The rb-*.json files of the folder (anything else in it is not a scenario), by path in the form a catalog takes. */
function readScenarioFiles(folder) {
  const files = {};
  for (const name of readdirSync(folder).filter((entry) => /^rb-.+\.json$/.test(entry)).sort()) {
    try {
      files[`./${name}`] = JSON.parse(readFileSync(join(folder, name), 'utf8'));
    } catch (error) {
      throw new Failure(1, `${name} is not JSON: ${messageOf(error)}`);
    }
  }
  return files;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.printCacheDir) {
    // The resolved config, as the server would get it: the plugins of the repo's config have had their say on it too
    process.stdout.write(`${(await resolveConfig(viteOptions, 'serve')).cacheDir}\n`);
    return;
  }
  const files = readScenarioFiles(options.scenarios);

  const server = await createServer(viteOptions);
  let text;
  try {
    let createScenarioCatalog;
    let robotScenarioManifest;
    let serializeManifest;
    try {
      ({ createScenarioCatalog } = await server.ssrLoadModule('/src/samples/robot-scenarios/index.ts'));
      ({ robotScenarioManifest, serializeManifest } = await server.ssrLoadModule('/src/samples/robot-scenarios/manifest.ts'));
    } catch (error) {
      // The module of the app's own catalog validates the scenarios of its folder as it loads
      throw new Failure(1, `The scenario sources did not load: ${messageOf(error)}`);
    }
    // One file at a time first, so that a scenario that does not validate is named by its file
    for (const [path, json] of Object.entries(files)) {
      try {
        createScenarioCatalog({ [path]: json });
      } catch (error) {
        throw new Failure(1, `${path.slice(2)}: ${messageOf(error)}`);
      }
    }
    text = serializeManifest(robotScenarioManifest(createScenarioCatalog(files)));
  } finally {
    await server.close();
  }

  const shown = relative(process.cwd(), options.out) || options.out;
  if (options.check) {
    const current = isFile(options.out) ? readFileSync(options.out, 'utf8') : null;
    if (current !== text) {
      throw new Failure(1, `${shown} is ${current === null ? 'missing' : 'out of date'}: run \`pnpm export:robot-manifest\` and commit the result (${plural(Object.keys(files).length)}).`);
    }
    process.stdout.write(`${shown} is up to date (${plural(Object.keys(files).length)}).\n`);
  } else {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, text);
    process.stdout.write(`${shown}: ${plural(Object.keys(files).length)}.\n`);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${messageOf(error)}\n`);
  process.exitCode = error instanceof Failure ? error.code : 1;
}
