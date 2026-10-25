// Builds the HEX of every parity fixture (N18 C2, robot plan C2; docs/adr/0003-avr8js-parity.md §7). Each fixture of
// tests/parity/fixtures.ts (the C1 language goldens and one program per driver op of ref-uno-rover@0) is turned into its sketch by
// the generator, compiled for arduino:avr:uno with the toolchain the UNO contract pins (§1: arduino-cli 1.5.1, arduino:avr@1.8.8,
// Servo 1.3.0; changing any of them is changing the contract), and written next to the sha256 of the sketch it came from:
//
//   tests/__parity__/<name>.hex          the Intel HEX arduino-cli built
//   tests/__parity__/<name>.ino.sha256   `<sha256 of the sketch>  <name>.ino`
//   tests/__parity__/toolchain.json      the pinned versions and each sketch's flash and RAM, as arduino-cli reported them
//
// The HEX and hash files are committed, so tests/uno-emulator-parity.test.ts runs on Node with no tool (avr8js runs the HEX). That
// test fails when a fixture's sketch is no longer the one hashed: run this script again (`pnpm build:parity-hex`) and commit.
//
//   node scripts/build-parity-hex.mjs [fixture-name ...]
//
// ARDUINO_CLI names the arduino-cli to run (default: the one on PATH). Exit codes: 0 built, 1 a sketch failed or a fixture is
// unknown, 2 the pinned toolchain is missing (nothing is written).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(root, 'tests', '__parity__');
const pinned = { cli: '1.5.1', core: { id: 'arduino:avr', version: '1.8.8' }, libraries: [{ name: 'Servo', version: '1.3.0' }], fqbn: 'arduino:avr:uno' };

const cli = process.env.ARDUINO_CLI || 'arduino-cli';
const log = (text) => process.stdout.write(`${text}\n`);
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const run = (args) => spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = (result) => `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(ansi, '');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Why the pinned toolchain cannot build here, or null when it can (the Servo library is installed at its version if missing). */
function missingToolchain() {
  const version = run(['version']);
  if (version.error || version.status !== 0) {
    return 'arduino-cli is not on PATH';
  }
  const found = /Version: (\S+)/.exec(output(version))?.[1];
  if (found !== pinned.cli) {
    return `arduino-cli is ${found ?? 'of an unknown version'}, the contract pins ${pinned.cli}`;
  }
  let cores;
  try {
    cores = JSON.parse(run(['core', 'list', '--format', 'json']).stdout || '{}');
  } catch {
    return 'arduino-cli core list gave no JSON';
  }
  const core = (cores.platforms ?? []).find((platform) => platform.id === pinned.core.id);
  if (core?.installed_version !== pinned.core.version) {
    return `the core must be ${pinned.core.id}@${pinned.core.version}, found ${core ? core.installed_version : 'none'}`;
  }
  let libraries;
  try {
    libraries = JSON.parse(run(['lib', 'list', '--format', 'json']).stdout || '{}');
  } catch {
    return 'arduino-cli lib list gave no JSON';
  }
  for (const library of pinned.libraries) {
    const installed = (libraries.installed_libraries ?? []).find((entry) => entry.library?.name === library.name)?.library?.version;
    if (installed === library.version) {
      continue;
    }
    if (installed !== undefined) {
      return `the library ${library.name} is ${installed}, the contract pins ${library.version}`;
    }
    const result = run(['lib', 'install', `${library.name}@${library.version}`]);
    if (result.status !== 0) {
      return `arduino-cli lib install ${library.name}@${library.version} failed`;
    }
  }
  return null;
}

/** The sizes arduino-cli printed. */
function sizesOf(text) {
  const flash = /Sketch uses (\d+) bytes .* Maximum is (\d+) bytes\./.exec(text);
  const ram = /Global variables use (\d+) bytes .* Maximum is (\d+) bytes\./.exec(text);
  return { flashBytes: flash ? Number(flash[1]) : null, ramBytes: ram ? Number(ram[1]) : null };
}

async function loadFixtures() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { parityFixtures, sketchOf } = await server.ssrLoadModule('/tests/parity/fixtures.ts');
    return parityFixtures.map((fixture) => ({ name: fixture.name, source: sketchOf(fixture) }));
  } finally {
    await server.close();
  }
}

const missing = missingToolchain();
if (missing) {
  log(`PENDING: ${missing}; no HEX built.`);
  process.exit(2);
}

const all = await loadFixtures();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !all.some((fixture) => fixture.name === name));
if (unknown.length > 0) {
  log(`FAIL: no parity fixture named ${unknown.join(', ')}`);
  process.exit(1);
}
const fixtures = wanted.length > 0 ? all.filter((fixture) => wanted.includes(fixture.name)) : all;
mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, 'toolchain.json');
let previous = { sketches: {} };
try {
  previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  // first build
}
const sketches = wanted.length > 0 ? { ...previous.sketches } : {};
const scratch = mkdtempSync(join(tmpdir(), 'parity-hex-'));
let failed = false;
try {
  for (const { name, source } of fixtures) {
    const sketchDir = join(scratch, name);
    const buildDir = join(scratch, `build-${name}`);
    mkdirSync(sketchDir, { recursive: true });
    writeFileSync(join(sketchDir, `${name}.ino`), source);
    const compiled = run(['compile', '--fqbn', pinned.fqbn, '--build-path', buildDir, sketchDir]);
    const text = output(compiled);
    if (compiled.status !== 0) {
      failed = true;
      log(`FAIL ${name}: ${text.split('\n').filter((line) => /error/i.test(line)).join(' | ') || text.trim().split('\n').slice(-3).join(' | ')}`);
      continue;
    }
    copyFileSync(join(buildDir, `${name}.ino.hex`), join(outDir, `${name}.hex`));
    writeFileSync(join(outDir, `${name}.ino.sha256`), `${sha256(source)}  ${name}.ino\n`);
    sketches[name] = sizesOf(text);
    log(`BUILT ${name}: flash ${sketches[name].flashBytes} B, RAM ${sketches[name].ramBytes} B`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// Files of fixtures that no longer exist go, so the folder is exactly the fixtures.
const names = new Set(all.map((fixture) => fixture.name));
for (const file of readdirSync(outDir)) {
  const name = file.replace(/\.(hex|ino\.sha256)$/, '');
  if (file !== 'toolchain.json' && !names.has(name)) {
    rmSync(join(outDir, file));
    delete sketches[name];
    log(`REMOVED ${file}`);
  }
}
const ordered = Object.fromEntries(Object.keys(sketches).sort().map((name) => [name, sketches[name]]));
const manifest = {
  fqbn: pinned.fqbn,
  arduinoCli: pinned.cli,
  core: `${pinned.core.id}@${pinned.core.version}`,
  libraries: pinned.libraries.map((library) => `${library.name}@${library.version}`),
  sketches: ordered,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
log(`${failed ? 'FAIL' : 'DONE'}: ${fixtures.length} fixtures, HEX in ${outDir}`);
process.exit(failed ? 1 : 0);
