import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Expr, YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
import { langCases } from './__fixtures__/lang-cases';
import { generateYbcMicroPython } from './generate';
import { MAX_EXPRESSION_DEPTH, MAX_STATEMENT_DEPTH } from './limits';

// The syntax gate of plan §13.9 (OQ-B): every golden goes through scripts/check-python-syntax.mjs,
// which uses mpy-cross when there is one and CPython's `ast.parse` otherwise. Without any
// checker the gate is PENDING: these tests are then SKIPPED, never passed. A syntax check
// proves syntax only, not that the program runs on MicroPython or a Yolo:Bit.

type Report = { status: 'pass' | 'fail' | 'pending'; checker: string | null; micropython: 'pass' | 'fail' | 'pending'; files: number; failures: { file: string; message: string }[] };

const check = (targets: string[] = [], env: Record<string, string> = {}): Report => {
  const result = spawnSync(process.execPath, ['scripts/check-python-syntax.mjs', '--json', ...targets], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...env } });
  return JSON.parse(result.stdout) as Report;
};

const goldens = check();
const available = goldens.status !== 'pending';

describe.skipIf(!available)(`syntax check of the generated Python (${goldens.checker ?? 'no checker'})`, () => {
  it('passes on every golden', () => {
    expect(goldens.failures).toEqual([]);
    expect(goldens.status).toBe('pass');
    // Only mpy-cross is a MicroPython check. A CPython pass must never be reported as one.
    expect(goldens.micropython).toBe(goldens.checker === 'mpy-cross' ? 'pass' : 'pending');
    expect(goldens.files).toBeGreaterThanOrEqual(langCases.length);
  });

  it('fails on a file with a syntax error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bad-py-'));
    try {
      writeFileSync(join(dir, 'bad.py'), 'if x\n    pass\n');
      const report = check([dir]);
      expect(report.status).toBe('fail');
      expect(report.failures).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes on the deepest nesting the generator accepts, and on text with every kind of escape', () => {
    const id = () => 'b';
    let expr: Expr = { type: 'int', kind: 'int', value: 1, blockId: id() };
    for (let level = 1; level < MAX_EXPRESSION_DEPTH - 1; level += 1) {
      expr = { type: 'int', kind: 'arith', op: level % 2 ? '+' : '*', left: { type: 'int', kind: 'int', value: 2, blockId: id() }, right: expr, blockId: id() };
    }
    let nested: YbcStatement = { kind: 'print', value: expr, blockId: id() };
    for (let level = 0; level < MAX_STATEMENT_DEPTH; level += 1) {
      nested = { kind: 'while', condition: { type: 'bool', kind: 'bool', value: false, blockId: id() }, body: [nested], blockId: id() };
    }
    const text = (value: string): Expr => ({ type: 'str', kind: 'str', value, blockId: id() });
    const escapes: YbcStatement[] = [
      "it's", '"', '\\', '\\\'"', 'a\nb\rc\td', '\u0000\u0001\u001f\u007f\u0080\u009f', 'đ ế ệ 😀 日本', '  ﻿',
    ].map((value) => ({ kind: 'print', value: text(value), blockId: id() }));
    const ir: YbcProgramIR = { onStart: [nested, ...escapes], forever: null, variables: [{ id: 'x', name: 'x', type: 'int' }] };
    const generated = generateYbcMicroPython(ir);
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    const dir = mkdtempSync(join(tmpdir(), 'deep-py-'));
    try {
      writeFileSync(join(dir, 'deep.py'), generated.source);
      expect(check([dir])).toMatchObject({ status: 'pass', files: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.runIf(!available)('syntax check is PENDING', () => {
  it('has no checker on this machine: L2 stays PENDING, install mpy-cross or Python 3', () => {
    expect(goldens.checker).toBeNull();
  });
});


// The mpy-cross path is what the YB-5A freeze needs, so its selection and its verdicts are tested with a
// stand-in executable (a POSIX shell script; Node will not start a .cmd on Windows, so this is skipped
// there). It checks nothing about MicroPython: it only proves the script prefers an `mpy-cross` and
// reports that checker's verdict as the MicroPython verdict.
const stubScript = ['#!/bin/sh', '[ "$1" = "--version" ] && exit 0', 'grep -q SYNTAXERR "$3" && exit 1', 'exit 0', ''].join(String.fromCharCode(10));

describe.skipIf(process.platform === 'win32')('the mpy-cross path (stand-in executable)', () => {
  it('prefers mpy-cross over CPython and reports its verdict as the MicroPython verdict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mpy-stub-'));
    try {
      const stub = join(dir, 'mpy-cross');
      writeFileSync(stub, stubScript, { mode: 0o755 });
      writeFileSync(join(dir, 'ok.py'), 'print(1)');
      expect(check([dir], { MPY_CROSS: stub })).toMatchObject({ status: 'pass', checker: 'mpy-cross', micropython: 'pass', files: 1 });
      writeFileSync(join(dir, 'bad.py'), 'SYNTAXERR');
      expect(check([dir], { MPY_CROSS: stub })).toMatchObject({ status: 'fail', checker: 'mpy-cross', micropython: 'fail' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
