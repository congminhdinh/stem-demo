// Syntax check of the generated Python (YB plan §13.9, OQ-B). It checks every golden
// (`__golden__/*.py`) and every fixture `expected.py` with the best checker the machine has:
//
//   1. `mpy-cross` (MPY_CROSS, or on PATH): the MicroPython compiler, closest to the target;
//   2. CPython 3 (`python3` or `python`; `python` or `py -3` on Windows): `ast.parse`, the fallback of the plan.
//
// Both prove SYNTAX only, never that the program runs on a Yolo:Bit (plan §6.9). Only mpy-cross is a
// MicroPython check: a CPython pass is a development fallback and is reported as
// "MicroPython syntax validation = PENDING". The YB-5A freeze needs mpy-cross to pass (`--require-mpy`).
// The checker is detected, never installed or downloaded. Without any checker the
// result is PENDING (never a pass).
//
//   node scripts/check-python-syntax.mjs [--require | --require-mpy] [--json] [file-or-directory ...]
//
// Exit codes: 0 all files pass (or PENDING without a --require flag), 1 a file fails,
// 2 --require and no checker ran, or --require-mpy and mpy-cross did not pass.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const skippedDirectories = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'artifacts', '.git']);

const log = (text) => process.stdout.write(text + String.fromCharCode(10));
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const targets = args.filter((arg) => !arg.startsWith('--'));

function collect(path, into) {
  const stats = statSync(path);
  if (stats.isFile()) {
    into.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && !skippedDirectories.has(entry.name)) {
      collect(join(path, entry.name), into);
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      const inGolden = basename(path) === '__golden__';
      if (inGolden || entry.name === 'expected.py' || targets.length > 0) {
        into.push(join(path, entry.name));
      }
    }
  }
}

const files = [];
for (const target of targets.length > 0 ? targets : [join(root, 'src'), join(root, 'tests')]) {
  collect(resolve(target), files);
}
files.sort();

const run = (command, commandArgs) => spawnSync(command, commandArgs, { encoding: 'utf8' });

/** The first checker that works: mpy-cross, then CPython 3. */
function detectChecker() {
  const mpy = process.env.MPY_CROSS || 'mpy-cross';
  if (run(mpy, ['--version']).status === 0) {
    return { name: 'mpy-cross', command: mpy, prefix: [], micropython: true };
  }
  // On Windows `python3` is usually the Microsoft Store stub, which is not a Python.
  const candidates = process.platform === 'win32' ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const probe = run(command, [...prefix, '-c', 'import sys; print(sys.version_info[0])']);
    if (probe.status === 0 && probe.stdout.trim() === '3') {
      return { name: 'cpython-ast', command, prefix, micropython: false };
    }
  }
  return null;
}

const astScript = [
  'import ast, sys',
  'bad = 0',
  'for path in sys.argv[1:]:',
  '    try:',
  '        with open(path, "rb") as handle:',
  '            data = handle.read()',
  '        ast.parse(data.decode("utf-8"), path)',
  '    except (SyntaxError, UnicodeDecodeError, ValueError) as error:',
  '        bad += 1',
  '        print(path + "\\t" + str(error).replace("\\n", " "))',
  'sys.exit(1 if bad else 0)',
].join('\n');

function check(checker) {
  const failures = [];
  if (checker.name === 'cpython-ast') {
    // One process for the whole corpus.
    const result = run(checker.command, [...checker.prefix, '-c', astScript, ...files]);
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const [path, message] = line.trim().split('\t');
      failures.push({ file: path, message: message?.trim() });
    }
    if (result.status !== 0 && failures.length === 0) {
      failures.push({ file: '(checker)', message: result.stderr.trim() || 'the checker failed' });
    }
    return failures;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'mpy-check-'));
  try {
    for (const file of files) {
      const result = run(checker.command, ['-o', join(scratch, 'out.mpy'), file]);
      if (result.status !== 0) {
        failures.push({ file, message: (result.stderr || result.stdout).trim() });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return failures;
}

const checker = detectChecker();
const display = (file) => relative(root, file).split(sep).join('/');
let report;
if (!checker) {
  report = { status: 'pending', checker: null, micropython: 'pending', files: files.length, failures: [] };
} else {
  const failures = check(checker).map((failure) => ({ ...failure, file: failure.file === '(checker)' ? failure.file : display(failure.file) }));
  const status = failures.length === 0 ? 'pass' : 'fail';
  // `status` is the verdict of whatever checker ran. `micropython` is the verdict about MicroPython: only mpy-cross gives one.
  report = { status, checker: checker.name, micropython: checker.micropython ? status : 'pending', files: files.length, failures };
}

if (flags.has('--json')) {
  log(JSON.stringify(report));
} else if (report.status === 'pending') {
  log(`PENDING: no syntax checker found (install mpy-cross, or Python 3); ${files.length} files not checked.`);
  log('MicroPython syntax validation = PENDING');
} else {
  for (const failure of report.failures) {
    log(`FAIL ${failure.file}: ${failure.message}`);
  }
  log(`${report.status.toUpperCase()}: ${files.length} files checked with ${checker.name}.`);
  log(
    report.micropython === 'pending'
      ? 'MicroPython syntax validation = PENDING (CPython ast.parse is a development fallback, not a MicroPython check; run with mpy-cross on PATH or MPY_CROSS).'
      : `MicroPython syntax validation = ${report.micropython.toUpperCase()} (mpy-cross).`,
  );
}

if (report.status === 'fail') {
  process.exit(1);
}
// --require: some checker must have run. --require-mpy (the YB-5A freeze condition): mpy-cross must have passed.
if ((flags.has('--require') && report.status === 'pending') || (flags.has('--require-mpy') && report.micropython !== 'pass')) {
  process.exit(2);
}
