// N18 C1: the identifiers a learner's variable must not take in a generated Arduino sketch because the pinned toolchain
// (arduino-cli 1.5.1, arduino:avr@1.8.8, Servo@1.3.0; docs/uno-compatibility-contract.md §1) already uses them at file scope.
// The generator (src/core/codegen/arduino/names.ts) reads the list this script writes to
// src/core/codegen/arduino/toolchain-names.ts; it never runs the toolchain itself.
//
// How the list is made, on the pinned toolchain only (the result is evidence, not a guess):
//   1. a small sketch with `#include <Servo.h>` is compiled, and the exact avr-g++ command arduino-cli used for it is taken from
//      `arduino-cli compile -v`;
//   2. that command, with -E, gives the preprocessed Arduino.h + Servo.h (-E -P) and every macro (-E -dM);
//   3. the candidates are every identifier of the preprocessed text and every macro name; a sketch declaring `long <name> = 0L;`
//      for each candidate is compiled, and every candidate whose line has an error (or a macro expanded into it) is kept;
//   4. kept as well: every object-like or function-like macro name, every class, struct, union, enum and namespace name of the
//      headers (a variable may hide a class, which breaks the `Servo <role>;` global or a helper's `Servo &` after it), and every
//      global symbol the core (core.a) and the Servo library define (`timer0_millis` is not declared in a header, but a variable of
//      that name would not link).
//   Names that start with `_` are left out (a learner name never does) and so are binary.h's B0…B11111111, which names.ts matches
//   with a pattern; C++ keywords are names.ts's own list.
//
//   node scripts/arduino-reserved-names.mjs [--write | --check]
//
// Exit codes: 0 written / up to date / printed, 1 --check found a difference, 2 the pinned toolchain is not on this machine.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = join(root, 'src/core/codegen/arduino/toolchain-names.ts');
const log = (text) => process.stdout.write(text + String.fromCharCode(10));
const cli = process.env.ARDUINO_CLI || 'arduino-cli';
const fqbn = 'arduino:avr:uno';
const pinned = { cli: '1.5.1', core: '1.8.8', servo: '1.3.0' };

const keywords = new Set(
  'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t class compl const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq'.split(
    ' ',
  ),
);
const binary = /^B[01]{1,8}$/;

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
/** arduino-cli's output without its colours (ESC [ … m). */
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (text) => text.replace(ansi, '');

function toolchain() {
  const version = run(cli, ['version']);
  if (version.status !== 0 || !version.stdout.includes(`Version: ${pinned.cli}`)) {
    return `arduino-cli ${pinned.cli} is not on PATH`;
  }
  const cores = JSON.parse(run(cli, ['core', 'list', '--format', 'json']).stdout || '{}');
  const core = (cores.platforms ?? []).find((platform) => platform.id === 'arduino:avr');
  if (core?.installed_version !== pinned.core) {
    return `arduino:avr@${pinned.core} is not installed`;
  }
  const libraries = JSON.parse(run(cli, ['lib', 'list', '--format', 'json']).stdout || '{}');
  if (!(libraries.installed_libraries ?? []).some((entry) => entry.library?.name === 'Servo' && entry.library?.version === pinned.servo)) {
    return `Servo@${pinned.servo} is not installed`;
  }
  return null;
}

/** Splits a command line arduino-cli printed into its arguments (paths here have no spaces or quotes). */
const argv = (line) => line.trim().split(/\s+/);

function extract() {
  const scratch = mkdtempSync(join(tmpdir(), 'arduino-names-'));
  try {
    const sketch = join(scratch, 'probe');
    mkdirSync(sketch);
    writeFileSync(join(sketch, 'probe.ino'), ['#include <Servo.h>', 'Servo probeServo;', 'void setup() {', '  probeServo.attach(9);', '  Serial.begin(9600);', '}', 'void loop() {', '}', ''].join('\n'));
    const build = join(scratch, 'build');
    const verbose = run(cli, ['compile', '-v', '--fqbn', fqbn, '--build-path', build, sketch]);
    if (verbose.status !== 0) {
      throw new Error(`the probe sketch does not compile:\n${plain(verbose.stdout + verbose.stderr)}`);
    }
    const commandLine = plain(verbose.stdout).split('\n').find((line) => /avr-g\+\+ /.test(line) && line.includes('probe.ino.cpp.o'));
    if (!commandLine) {
      throw new Error('arduino-cli -v did not print the compile command of the sketch');
    }
    const [gxx, ...flags] = argv(commandLine);
    const keep = [];
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index];
      if (flag === '-o') {
        index += 1; // and its file
      } else if (!['-c', '-MMD', '-flto', '-g'].includes(flag)) {
        keep.push(flag);
      }
    }
    const macroText = run(gxx, ['-E', '-dM', ...keep]).stdout;
    const preprocessed = run(gxx, ['-E', '-P', ...keep]).stdout.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    const macros = new Set([...macroText.matchAll(/^#define ([A-Za-z_]\w*)/gm)].map((match) => match[1]));
    const identifiers = new Set(preprocessed.match(/\b[A-Za-z_]\w*\b/g) ?? []);
    const tags = new Set([...preprocessed.matchAll(/\b(?:class|struct|union|enum|namespace)\s+([A-Za-z_]\w*)/g)].map((match) => match[1]));

    const candidates = [...new Set([...identifiers, ...macros])].filter((name) => !name.startsWith('_') && !keywords.has(name) && !binary.test(name)).sort();
    const declarations = join(scratch, 'decl');
    mkdirSync(declarations);
    const first = 2;
    writeFileSync(join(declarations, 'decl.ino'), ['#include <Servo.h>', ...candidates.map((name) => `long ${name} = 0L;`), 'void setup() {', '}', 'void loop() {', '}', ''].join('\n'));
    const declared = run(cli, ['compile', '--fqbn', fqbn, '--build-path', join(scratch, 'decl-build'), declarations]);
    const diagnostics = plain(declared.stdout + declared.stderr);
    const failing = new Set();
    for (const match of diagnostics.matchAll(/decl\.ino:(\d+):\d+: (?:error|warning|note: in expansion of macro)/g)) {
      const name = candidates[Number(match[1]) - first];
      if (name !== undefined) {
        failing.add(name);
      }
    }

    const nm = join(gxx, '..', 'avr-gcc-nm');
    const objects = [join(build, 'core', 'core.a'), join(build, 'libraries', 'Servo', 'avr', 'Servo.cpp.o')];
    const symbols = new Set(
      run(nm, objects)
        .stdout.split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields.length === 3 && /^[TDBCRVW]$/.test(fields[1] ?? ''))
        .map((fields) => fields[2]),
    );

    const names = new Set([...failing, ...macros, ...tags, ...symbols].filter((name) => /^[A-Za-z]\w*$/.test(name) && !keywords.has(name) && !binary.test(name)));
    return { names: [...names].sort(), counts: { candidates: candidates.length, failing: failing.size, macros: macros.size, tags: tags.size, symbols: symbols.size } };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The TypeScript of the list: sorted, in lines of at most 120 characters, so a change of the toolchain is a readable diff. */
function render(names) {
  const lines = [];
  let line = '';
  for (const name of names) {
    if (line.length + name.length + 1 > 110) {
      lines.push(line);
      line = name;
    } else {
      line = line ? `${line} ${name}` : name;
    }
  }
  if (line) {
    lines.push(line);
  }
  return [
    '// GENERATED by scripts/arduino-reserved-names.mjs (N18 C1) from arduino-cli 1.5.1, arduino:avr@1.8.8 and Servo@1.3.0; do not edit.',
    '// Every identifier the pinned toolchain uses at file scope, which a learner variable of a generated sketch must not take (the',
    '// script says how the list is made). Regenerate with `node scripts/arduino-reserved-names.mjs --write` when the contract pins',
    '// another toolchain.',
    '',
    '/** Space-separated names, sorted; read through `toolchainNames()`. */',
    'const lines: readonly string[] = [',
    ...lines.map((text) => `  '${text}',`),
    '];',
    '',
    'let names: ReadonlySet<string> | undefined;',
    '',
    '/** The names, as a set (built on first use, so the list costs nothing until a sketch is generated). */',
    'export function toolchainNames(): ReadonlySet<string> {',
    "  names ??= new Set(lines.join(' ').split(' '));",
    '  return names;',
    '}',
    '',
  ].join('\n');
}

const flags = new Set(process.argv.slice(2));
const missing = toolchain();
if (missing) {
  log(`PENDING: ${missing}; the reserved names were not extracted.`);
  process.exit(2);
}
const { names, counts } = extract();
const text = render(names);
log(`${names.length} names (candidates ${counts.candidates}, failing declarations ${counts.failing}, macros ${counts.macros}, tags ${counts.tags}, symbols ${counts.symbols}).`);
if (flags.has('--write')) {
  writeFileSync(target, text);
  log(`Wrote ${target}.`);
} else if (flags.has('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // compared below
  }
  if (current !== text) {
    log(`FAIL: ${target} is not what the pinned toolchain gives; run with --write.`);
    process.exit(1);
  }
  log('PASS: the reserved names are the pinned toolchain’s.');
} else {
  log(names.join(' '));
}
