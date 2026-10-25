// Verifies stored robot lab attempts (N18 R8a, robot plan §R8): re-runs each attempt headless with the real check of this build
// (checkRobot on the project STEMLearning stored, with the scenario of its key, the variant seeds of the scenario and the engine of this
// build) and compares what the attempt says with what the re-run gives. The base of a later server-side verifier. docs/robot-attempt-
// verification.md says how a teacher or admin runs it and what each status means.
//
//   node scripts/verify-attempt.mjs <file.json | -> [--json]
//   pnpm verify:attempt <file.json | -> [--json]
//
//   <file.json>  one attempt, or a list of a learner's attempts oldest first: the API's camelCase LabAttemptDto of a robot lab, with the
//                project document in `projectJson` (the entity's ProjectJson; an attempt without one takes the project of the latest
//                earlier attempt with its programHash and key). `-` reads it from stdin.
//   --json       print a machine-readable result: per attempt { index, id?, templateKey?, status: 'match' | 'mismatch' | 'unverifiable',
//                reason?, detail?, problems?, diffs?: [{ field, attempt, rerun }], projectFrom? }; an object for one attempt, a list for a
//                list. Without it, one line per attempt and one line per differing field.
//
// Exit codes: 0 every attempt matches; 1 an attempt mismatches (a field differs); 2 an attempt cannot be verified (its reason:
// invalid-attempt, unknown-key, scenario-version, engine, seed-mismatch, no-project, project-invalid, rerun-failed), or a usage error. A
// mismatch outranks an attempt that cannot be verified.
//
// The input is untrusted: src/core/scenario/verify-attempt.ts (`verifyAttemptText`) reads it, its size first (at most 32 MiB:
// ATTEMPT_LIMITS.inputMaxBytes, 500 attempts of which at most 20 keep a project of 256 KiB), then JSON, then Zod with the LMS's rules, before
// anything runs; nothing of it is ever evaluated. A longer file is not read. The text output escapes the input's control characters.
//
// The sources are TypeScript with extensionless imports, and the scenario catalog (src/samples/robot-scenarios/index.ts) uses
// `import.meta.glob`: the script loads them through Vite's SSR loader, as scripts/export-robot-manifest.mjs does, with nothing faked, and the
// catalog it verifies against is the one this build ships. The physics is Rapier's -compat build, the one a plain Node process can load
// (ADR 0001 §5.2: the same wasm as the app's split package, the same results; tests/robot-determinism.test.ts holds both to the same hashes).
// Its Vite server has no config file (no plugin is needed to load core TypeScript) and a dependency cache of its own,
// node_modules/.vite-verify-attempt, so it never touches node_modules/.vite, which `pnpm dev` and the e2e runs share.

import { Buffer } from 'node:buffer';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const usage = 'Usage: node scripts/verify-attempt.mjs <file.json | -> [--json]';

/** A failure with the exit code it ends the script with (a usage error, or a fault of this build). */
class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const messageOf = (error) => (error instanceof Error ? error.message : String(error));

function parseArguments(args) {
  const files = [];
  let json = false;
  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--')) {
      throw new Failure(2, `Unknown option ${arg}. ${usage}`);
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 1) {
    throw new Failure(2, `Name one attempt file, or - for stdin. ${usage}`);
  }
  return { file: files[0], json };
}

/** The input's text, at most `maxBytes` (the core's ATTEMPT_LIMITS.inputMaxBytes); null when it is longer, which is never read whole. */
async function readInput(file, maxBytes) {
  if (file === '-') {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > maxBytes) {
        return null;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const path = resolve(file);
  let size;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      throw new Failure(2, `${file} is not a file. ${usage}`);
    }
    size = stats.size;
  } catch (error) {
    throw error instanceof Failure ? error : new Failure(2, `${file} cannot be read: ${messageOf(error)}`);
  }
  return size > maxBytes ? null : readFileSync(path, 'utf8');
}

/** Runs `use` with the module loader of a Vite SSR server (see the header), and closes the server after. */
async function withSources(use) {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    cacheDir: join(root, 'node_modules', '.vite-verify-attempt'),
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await use((path) => server.ssrLoadModule(path));
  } finally {
    await server.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { outcome, lines, code } = await withSources(async (load) => {
    const core = await load('/src/core/scenario/verify-attempt.ts');
    const maxBytes = core.ATTEMPT_LIMITS.inputMaxBytes;
    const text = await readInput(options.file, maxBytes);
    let verified;
    if (text === null) {
      verified = core.invalidInputOutcome(`longer than ${maxBytes} UTF-8 bytes`);
    } else {
      // This build's scenarios, kits and devices, with the -compat Rapier; the core reads the text (its size, then JSON, then the schema).
      const { initPhysics } = await load('/src/core/world/rapier.ts');
      const { scenarioCatalog } = await load('/src/samples/robot-scenarios/index.ts');
      const { productionKits } = await load('/src/core/hardware/catalog.ts');
      const { createDeviceRegistry } = await load('/src/core/devices/registry.ts');
      const { localDeviceDefinitions } = await load('/src/core/devices/local-catalog.ts');
      await initPhysics(async () => import('@dimforge/rapier3d-deterministic-compat'));
      const env = core.createVerifyEnvironment({ scenarios: scenarioCatalog, kits: productionKits, registry: createDeviceRegistry(localDeviceDefinitions) });
      verified = await core.verifyAttemptText(text, env);
    }
    return { outcome: verified, lines: core.describeReports(verified.reports), code: core.verifyExitCode(verified.reports) };
  });
  // JSON escapes every control character of the input; the text lines are escaped by describeReports.
  process.stdout.write(options.json ? `${JSON.stringify(outcome.many ? outcome.reports : outcome.reports[0])}\n` : `${lines.join('\n')}\n`);
  process.exitCode = code;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${messageOf(error)}\n`);
  process.exitCode = error instanceof Failure ? error.code : 2;
}
