import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredProject } from '../persistence/project-repository';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import {
  createFixtureEnvironment, fixtureDocument, programWithMarker,
} from '../profiles/__fixtures__/test-profiles';
import {
  add, countUp, getVar, ifElif, bool, num, print, program, repeat, setVar, text, wait, whileLoop, cmp, type Json,
} from '../program/__fixtures__/ybc-blocks';
import { MAX_CONSOLE_ENTRIES, MAX_PROGRAM_BLOCKS } from '../program/limits';
import { createTemplateProject } from '../../samples/templates';
import { createRunSession } from './run-session';

// RunSession with the YB-2b language: loops, wait, console under load, preflight, no silent no-op.

const registry = createDeviceRegistry(localDeviceDefinitions);
const document = (blocks: Json, profile = 'ybc-basic') => fixtureDocument(profile, { blocks });
const prog = (statements: Json[], forever?: Json[]) => program(statements, forever, ['x', 'y', 'z', 'i']);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RunSession, YB-2b programs', () => {
  it('runs a repeat, a while and a count up to their end, printing to the console', async () => {
    const session = createRunSession(registry);
    session.start(
      document(
        prog([
          repeat(num(3), [setVar('x', add(getVar('x'), num(1)))]),
          whileLoop(cmp('LT', getVar('y'), num(2)), [setVar('y', add(getVar('y'), num(1)))]),
          countUp('i', num(1), num(3), 1, [setVar('z', add(getVar('z'), getVar('i')))]),
          print(getVar('x')),
          print(getVar('y')),
          print(getVar('z')),
        ]),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', console: { lines: ['3', '2', '6'] } });
  });

  it('waits the given time of the clock, then goes on', async () => {
    const session = createRunSession(registry);
    session.start(document(prog([print(text('a')), wait(num(1000)), print(text('b'))])));
    await vi.advanceTimersByTimeAsync(999);
    expect(session.getSnapshot().console?.lines).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getSnapshot().console?.lines).toEqual(['a', 'b']);
  });

  it('stops a long wait at once on Stop, and nothing is printed afterwards', async () => {
    const session = createRunSession(registry);
    session.start(document(prog([wait(num(60_000)), print(text('never'))])));
    await vi.advanceTimersByTimeAsync(10);
    session.stop();
    expect(session.getSnapshot().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(session.getSnapshot()).toEqual({ status: 'idle', diagnostics: [], error: null, simulation: null });
  });

  it('keeps the forever pause at 10 ms and prints once per iteration', async () => {
    const session = createRunSession(registry);
    session.start(document(prog([], [print(text('tick'))])));
    await vi.advanceTimersByTimeAsync(100);
    // one tick at 0 ms, then one every 10 ms
    expect(session.getSnapshot().console?.lines).toHaveLength(11);
    session.stop();
  });

  it('reports a domain fault of a loop with its code and block', async () => {
    const session = createRunSession(registry);
    const loop = repeat(add(num(2_000_000), num(0)), [print(text('never'))]);
    session.start(document(prog([loop])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'out-of-domain' } });
  });

  it('refuses a loop with a typed-in count outside the domain before running', () => {
    const result = createRunSession(registry).start(document(prog([repeat(num(2_000_000), [])])));
    expect(result).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ code: 'value-out-of-range' }] });
  });

  it('runs else-if programs', async () => {
    const session = createRunSession(registry);
    session.start(document(prog([ifElif([[bool(false), [print(text('a'))]], [bool(true), [print(text('b'))]]], [print(text('c'))])])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().console?.lines).toEqual(['b']);
  });

  it('refuses random, which stays excluded, with not-eligible', () => {
    const result = createRunSession(registry).start(document(prog([{ type: 'math_random_int', id: 'r' }])));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'not-eligible', blockId: 'r' }] });
  });
});

describe('the console under a print-heavy loop', () => {
  it('stays at 500 lines, counts the rest as hidden, and the newest lines are the ones kept', async () => {
    const session = createRunSession(registry);
    session.start(document(prog([countUp('i', num(1), num(10_000), 1, [print(getVar('i'))])])));
    await vi.advanceTimersByTimeAsync(100);

    const { lines, hidden } = session.getSnapshot().console ?? { lines: [], hidden: 0 };
    expect(lines).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(lines[0]).toBe('9501');
    expect(lines.at(-1)).toBe('10000');
    expect(hidden).toBe(9_500);
    expect(session.getSnapshot().status).toBe('finished');
  });

  it('tells its listeners once per burst of prints, not once per print', async () => {
    const session = createRunSession(registry);
    let notices = 0;
    session.subscribe(() => notices++);
    session.start(document(prog([repeat(num(10_000), [print(num(1))])])));
    await vi.advanceTimersByTimeAsync(100);

    // start (running), one burst notice, finished: nobody read the snapshot in between
    expect(notices).toBeLessThanOrEqual(4);
  });

  it('never holds more than a bounded console: bytes included', async () => {
    const session = createRunSession(registry);
    const long = text('x'.repeat(1000));
    session.start(document(prog([repeat(num(2_000), [print(long)])])));
    await vi.advanceTimersByTimeAsync(100);
    const { lines } = session.getSnapshot().console ?? { lines: [] };
    expect(lines.length * 1001).toBeLessThanOrEqual(256 * 1024);
    expect(lines.length).toBeGreaterThan(200);
  });
});

describe('no silent no-op', () => {
  it('refuses a block the profile exposes but the compiler has no meaning for', () => {
    const { registry: fixtureRegistry, profiles, packs } = createFixtureEnvironment();
    const session = createRunSession(fixtureRegistry, { profiles, packs });
    const result = session.start(document(programWithMarker(), 'test-extended'));
    expect(result).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ code: 'unsupported-construct', blockId: 'marker-1' }] });
  });

  it('lets the test-only marker through only when the fixture says so', async () => {
    const { registry: fixtureRegistry, profiles, packs, noopBlockTypes } = createFixtureEnvironment();
    const session = createRunSession(fixtureRegistry, { profiles, packs, noopBlockTypes });
    expect(session.start(document(programWithMarker(), 'test-extended'))).toEqual({ ok: true });
    session.stop();
  });
});

describe('the program-size preflight is for Yolo:Bit-compatible programs only', () => {
  const manyPrints = (count: number) => prog(Array.from({ length: count }, () => print(num(1))));

  it('refuses a YBC program over 2000 blocks before compiling it, and runs one at 2000', () => {
    const session = createRunSession(registry);
    expect(session.start(document(manyPrints(MAX_PROGRAM_BLOCKS)))).toMatchObject({
      ok: false,
      reason: 'compile-error',
      diagnostics: [{ code: 'program-too-large' }],
    });
    expect(session.start(document(manyPrints((MAX_PROGRAM_BLOCKS - 2) / 2)))).toEqual({ ok: true });
    session.stop();
  });

  it('still loads such a YBC document: it is a valid, editable one (L-1)', () => {
    const big = document(manyPrints(MAX_PROGRAM_BLOCKS));
    expect(readStoredProject(big, registry, () => true)).not.toBeNull();
  });

  it('does not touch generic documents: a large generic document opens and runs as before (GB6)', () => {
    const generic = createTemplateProject('led-on');
    const loose = Array.from({ length: 3_000 }, (_, index) => ({ type: 'stem_wait', id: `loose-${index}` }));
    const blocks = { blocks: { languageVersion: 0, blocks: [...(generic.program.blocks as { blocks: { blocks: unknown[] } }).blocks.blocks, ...loose] } };
    const large = { ...generic, program: { blocks } };

    expect(readStoredProject(large, registry, () => true)).not.toBeNull();
    const result = createRunSession(registry).start(large);
    expect(result).toEqual({ ok: true });
  });

  it('refuses a huge list of junk without walking it, and survives a cycle', () => {
    const cyclic: Record<string, unknown> = {
      type: 'text_print',
      id: 'loop',
      inputs: { TEXT: { block: { type: 'text', id: 'loop-text', fields: { TEXT: 'a' } } } },
    };
    cyclic.next = { block: cyclic };
    const hat = { type: 'stem_on_start', id: 'on-start', inputs: { DO: { block: cyclic } } };
    const huge = { blocks: { languageVersion: 0, blocks: new Array(5_000_000).fill(null) } };

    expect(createRunSession(registry).start(document(huge))).toMatchObject({ ok: false, diagnostics: [{ code: 'program-too-large' }] });
    const cycle = createRunSession(registry).start(document({ blocks: { languageVersion: 0, blocks: [hat] } }));
    expect(cycle).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'malformed-program' })]) });
  });
});
