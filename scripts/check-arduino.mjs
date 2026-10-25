// L2 compile check of the generated Arduino sketches (N18 C1, robot plan C1; docs/uno-compatibility-contract.md §1, §8, §12). Every
// golden sketch (`__golden__/*.ino` under src/ and tests/; the scenario solutions' sketches join them as goldens) is compiled for
// arduino:avr:uno with the toolchain the contract pins, arduino-cli 1.5.1 and arduino:avr@1.8.8:
//
//   - the libraries a sketch names in its header (`// … Libraries: Servo@1.3.0 (LGPL-2.1), …`, written from the drivers'
//     `cpp.libraries`) are installed at that exact version when they are missing (`arduino-cli lib install Servo@1.3.0`); a GPL
//     library is refused (LGPL is allowed);
//   - `arduino-cli compile --fqbn arduino:avr:uno --warnings all`: the sketch must compile with no warning of its own (warnings of the
//     core and of libraries are not the sketch's) and use at most 75 % of the RAM (1536 of 2048 bytes, contract §8); flash and RAM are
//     reported as arduino-cli measures them.
//
// Without arduino-cli 1.5.1 or arduino:avr@1.8.8 the result is L2 = PENDING, never a pass. The tools are detected, never installed.
//
//   node scripts/check-arduino.mjs [--require] [--json] [file-or-directory ...]
//
// ARDUINO_CLI names the arduino-cli to run (default: the one on PATH). Exit codes: 0 every sketch passes (or PENDING without
// --require), 1 a sketch fails, 2 --require and the check is PENDING.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const skippedDirectories = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'artifacts', '.git', 'spikes']);
const pinned = { cli: '1.5.1', core: { id: 'arduino:avr', version: '1.8.8' }, fqbn: 'arduino:avr:uno', ramMaxPercent: 75 };

const log = (text) => process.stdout.write(text + String.fromCharCode(10));
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const targets = args.filter((arg) => !arg.startsWith('--'));
const cli = process.env.ARDUINO_CLI || 'arduino-cli';
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const run = (command, commandArgs) => spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = (result) => `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(ansi, '');

function collect(path, into, explicit) {
  const stats = statSync(path);
  if (stats.isFile()) {
    into.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && !skippedDirectories.has(entry.name)) {
      collect(join(path, entry.name), into, explicit);
    } else if (entry.isFile() && entry.name.endsWith('.ino') && (explicit || basename(path) === '__golden__')) {
      into.push(join(path, entry.name));
    }
  }
}

const files = [];
for (const target of targets.length > 0 ? targets : [join(root, 'src'), join(root, 'tests')]) {
  collect(resolve(target), files, targets.length > 0);
}
files.sort();
const display = (file) => {
  const inside = relative(root, file);
  return inside.startsWith('..') ? file : inside.split(sep).join('/');
};

/** Why the pinned toolchain cannot run here, or null when it can. */
function missingToolchain() {
  const version = run(cli, ['version']);
  if (version.error || version.status !== 0) {
    return 'arduino-cli is not on PATH';
  }
  const found = /Version: (\S+)/.exec(output(version))?.[1];
  if (found !== pinned.cli) {
    return `arduino-cli is ${found ?? 'of an unknown version'}, the contract pins ${pinned.cli}`;
  }
  let cores;
  try {
    cores = JSON.parse(run(cli, ['core', 'list', '--format', 'json']).stdout || '{}');
  } catch {
    return 'arduino-cli core list gave no JSON';
  }
  const core = (cores.platforms ?? []).find((platform) => platform.id === pinned.core.id);
  if (!core) {
    return `the core ${pinned.core.id} is not installed`;
  }
  if (core.installed_version !== pinned.core.version) {
    return `the core is ${pinned.core.id}@${core.installed_version}, the contract pins ${pinned.core.version}`;
  }
  return null;
}

/** The libraries a sketch's header names: `name@version (license)`, the core (a name with `:`) apart. */
function librariesOf(source) {
  const line = source.split('\n').find((text) => text.startsWith('// ') && text.includes('Libraries: '));
  if (!line) {
    return null;
  }
  return [...line.slice(line.indexOf('Libraries: ') + 'Libraries: '.length).matchAll(/([\w:.-]+)@([\w.-]+) \(([^)]+)\)/g)].map((match) => ({ name: match[1], version: match[2], license: match[3] }));
}

const isGpl = (license) => /(^|[^L])GPL/.test(license);

let installed;
/** Installs `name@version` when it is not installed at that version; an error text, or null. */
function ensureLibrary(library) {
  if (!installed) {
    try {
      const listed = JSON.parse(run(cli, ['lib', 'list', '--format', 'json']).stdout || '{}');
      installed = new Set((listed.installed_libraries ?? []).map((entry) => `${entry.library?.name}@${entry.library?.version}`));
    } catch {
      installed = new Set();
    }
  }
  const key = `${library.name}@${library.version}`;
  if (installed.has(key)) {
    return null;
  }
  const result = run(cli, ['lib', 'install', key]);
  if (result.status !== 0) {
    return `arduino-cli lib install ${key} failed: ${output(result).trim().split('\n').slice(-1)[0] ?? ''}`;
  }
  installed.add(key);
  return null;
}

/** The sizes arduino-cli printed. */
function sizesOf(text) {
  const flash = /Sketch uses (\d+) bytes \((\d+)%\) of program storage space\. Maximum is (\d+) bytes\./.exec(text);
  const ram = /Global variables use (\d+) bytes \((\d+)%\) of dynamic memory, leaving \d+ bytes for local variables\. Maximum is (\d+) bytes\./.exec(text);
  return {
    flashBytes: flash ? Number(flash[1]) : null,
    flashMax: flash ? Number(flash[3]) : null,
    ramBytes: ram ? Number(ram[1]) : null,
    ramMax: ram ? Number(ram[3]) : null,
  };
}

function check(file, scratch) {
  const name = basename(file, '.ino').replace(/[^A-Za-z0-9_.-]/g, '_');
  const source = readFileSync(file, 'utf8');
  const result = { file: display(file), status: 'pass', problems: [], libraries: [], flashBytes: null, flashPercent: null, ramBytes: null, ramPercent: null };
  const libraries = librariesOf(source);
  if (libraries === null) {
    result.problems.push('the header names no libraries (a generated sketch says "Libraries: …")');
  } else {
    result.libraries = libraries.map((library) => `${library.name}@${library.version}`);
    for (const library of libraries) {
      if (isGpl(library.license)) {
        result.problems.push(`${library.name}@${library.version} is ${library.license}: a generated sketch uses no GPL library`);
      } else if (library.name.includes(':')) {
        if (`${library.name}@${library.version}` !== `${pinned.core.id}@${pinned.core.version}`) {
          result.problems.push(`the sketch names the core ${library.name}@${library.version}, the contract pins ${pinned.core.id}@${pinned.core.version}`);
        }
      } else {
        const failed = ensureLibrary(library);
        if (failed) {
          result.problems.push(failed);
        }
      }
    }
  }
  if (result.problems.length > 0) {
    result.status = 'fail';
    return result;
  }
  const sketch = join(scratch, name);
  mkdirSync(sketch, { recursive: true });
  copyFileSync(file, join(sketch, `${name}.ino`));
  const compiled = run(cli, ['compile', '--fqbn', pinned.fqbn, '--warnings', 'all', '--build-path', join(scratch, `build-${name}`), sketch]);
  const text = output(compiled);
  const sizes = sizesOf(text);
  Object.assign(result, {
    flashBytes: sizes.flashBytes,
    flashPercent: sizes.flashBytes !== null && sizes.flashMax ? Number(((100 * sizes.flashBytes) / sizes.flashMax).toFixed(1)) : null,
    ramBytes: sizes.ramBytes,
    ramPercent: sizes.ramBytes !== null && sizes.ramMax ? Number(((100 * sizes.ramBytes) / sizes.ramMax).toFixed(2)) : null,
  });
  if (compiled.status !== 0) {
    const errors = text.split('\n').filter((line) => /: (fatal )?error: |Error during build/.test(line));
    result.problems.push(`does not compile: ${(errors.length > 0 ? errors : text.trim().split('\n').slice(-3)).join(' | ')}`);
  }
  // A warning is the sketch's when it is reported in the sketch itself (its .ino, or the .ino.cpp arduino-cli makes of it).
  const own = text.split('\n').filter((line) => / warning: /.test(line) && (line.includes(`${name}.ino:`) || line.includes(`${name}.ino.cpp:`)));
  result.problems.push(...own.map((line) => `warning: ${line.slice(line.indexOf('warning: ') + 'warning: '.length)}`));
  if (/Low memory available/.test(text)) {
    result.problems.push('arduino-cli warns "Low memory available"');
  }
  // On the bytes, not on the rounded percentage: 1537 of 2048 B is 75.05 %, already too much (contract §8, CC-02).
  if (sizes.ramBytes !== null && sizes.ramMax && sizes.ramBytes * 100 > pinned.ramMaxPercent * sizes.ramMax) {
    result.problems.push(`uses ${result.ramPercent} % of the RAM (${sizes.ramBytes} of ${sizes.ramMax} B), above ${pinned.ramMaxPercent} %`);
  }
  if (compiled.status === 0 && sizes.ramBytes === null) {
    result.problems.push('arduino-cli printed no sizes');
  }
  if (result.problems.length > 0) {
    result.status = 'fail';
  }
  return result;
}

const missing = missingToolchain();
let report;
if (missing) {
  report = { status: 'pending', reason: missing, toolchain: null, files: files.length, results: [] };
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'arduino-check-'));
  try {
    const results = files.map((file) => check(file, scratch));
    report = {
      status: results.some((result) => result.status === 'fail') ? 'fail' : 'pass',
      reason: null,
      toolchain: `arduino-cli ${pinned.cli}, ${pinned.core.id}@${pinned.core.version}, ${pinned.fqbn}`,
      files: files.length,
      results,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (flags.has('--json')) {
  log(JSON.stringify(report));
} else if (report.status === 'pending') {
  log(`PENDING: ${report.reason}; ${files.length} sketches not compiled.`);
  log('L2 = PENDING');
} else {
  for (const result of report.results) {
    const size = result.ramBytes === null ? 'no sizes' : `flash ${result.flashBytes} B (${result.flashPercent} %), RAM ${result.ramBytes} B (${result.ramPercent} %)`;
    log(`${result.status.toUpperCase()} ${result.file}: ${size}${result.libraries.length > 0 ? `; ${result.libraries.join(', ')}` : ''}`);
    for (const problem of result.problems) {
      log(`  ${problem}`);
    }
  }
  log(`${report.status.toUpperCase()}: ${report.files} sketches compiled with ${report.toolchain}.`);
  log(`L2 = ${report.status.toUpperCase()}`);
}

if (report.status === 'fail') {
  process.exit(1);
}
if (flags.has('--require') && report.status === 'pending') {
  process.exit(2);
}
