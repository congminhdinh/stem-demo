import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { createFixtureEnvironment, fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { MAX_CONSOLE_ENTRIES } from '../program/limits';
import {
  add, and, bool, cmp, getVar, idiv, ifThen, num, print, program, setVar, text, type Json,
} from '../program/__fixtures__/ybc-blocks';
import { createTemplateProject } from '../../samples/templates';
import { createRunSession, type RunSnapshot } from './run-session';

// RunSession with the YB-2a language (plan §9.0, §6.7): compile, run, console, faults, Stop.

const registry = createDeviceRegistry(localDeviceDefinitions);
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };
const document = (blocks: Json, profile = 'ybc-basic') => fixtureDocument(profile, { blocks });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RunSession, a YB-2a program', () => {
  it('runs x = 1; x = x + 2; print(x) and shows 3 on the console', async () => {
    const session = createRunSession(registry);
    const project = document(program([setVar('x', num(1)), setVar('x', add(getVar('x'), num(2))), print(getVar('x'))]));

    expect(session.start(project)).toEqual({ ok: true });
    expect(session.getSnapshot().console).toEqual({ lines: [], hidden: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(session.getSnapshot()).toMatchObject({ status: 'finished', error: null, console: { lines: ['3'], hidden: 0 } });
  });

  it('runs on start, then the forever body again and again, until Stop', async () => {
    const session = createRunSession(registry);
    expect(session.start(document(program([print(text('start'))], [print(text('tick'))])))).toEqual({ ok: true });

    await vi.advanceTimersByTimeAsync(35);
    expect(session.getSnapshot().status).toBe('running');
    expect(session.getSnapshot().console?.lines).toEqual(['start', 'tick', 'tick', 'tick', 'tick']);

    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('takes the same path for Basic and Advanced', async () => {
    for (const profile of ['ybc-basic', 'ybc-advanced']) {
      const session = createRunSession(registry);
      expect(session.start(document(program([print(num(7))]), profile))).toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getSnapshot().console?.lines).toEqual(['7']);
    }
  });

  it('does not start a program that does not compile: structured diagnostics, each with its block', () => {
    const session = createRunSession(registry);
    const wrong = text('hi');
    const result = session.start(document(program([setVar('x', wrong)])));

    expect(result).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ severity: 'error', code: 'type-mismatch', blockId: wrong.id }] });
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('reports an invalid condition, an undefined variable and a float', () => {
    const codesOf = (blocks: Json) => {
      const result = createRunSession(registry).start(document(blocks));
      return result.ok ? [] : result.diagnostics.map((d) => d.code);
    };
    expect(codesOf(program([ifThen(num(1), [print(num(1))])]))).toEqual(['invalid-condition']);
    expect(codesOf(program([print(getVar('nope'))]))).toEqual(['undefined-variable']);
    expect(codesOf(program([print(num(1.5))]))).toEqual(['float-not-supported']);
  });

  it('refuses random with not-eligible, and a loop block as unknown', () => {
    const run = (type: string) => createRunSession(registry).start(document(program([{ type, id: 'b' }])));
    expect(run('math_random_int')).toMatchObject({ ok: false, diagnostics: [{ code: 'not-eligible', blockId: 'b' }] });
    expect(run('controls_whileUntil')).toMatchObject({ ok: false, diagnostics: [{ code: 'unknown-block', blockId: 'b' }] });
  });

  it('stops at a runtime fault with its code and block, keeping what was printed before', async () => {
    const session = createRunSession(registry);
    const division = idiv(num(1), num(0));
    expect(session.start(document(program([print(text('before')), print(division), print(text('after'))])))).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(session.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'zero-division', blockId: division.id },
      console: { lines: ['before'] },
    });
    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('short-circuits: a failing right side is not run', async () => {
    const session = createRunSession(registry);
    const failing = cmp('EQ', idiv(num(1), num(0)), num(1));
    session.start(document(program([print(and(bool(false), failing)), print(text('done'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', console: { lines: ['False', 'done'] } });
  });
});

describe('RunSession, console limits and Stop', () => {
  it('keeps at most 500 lines when a program prints without end, and Stop is immediate', async () => {
    const session = createRunSession(registry);
    session.start(document(program([], [print(num(1))])));

    await vi.advanceTimersByTimeAsync(10_000);
    const { console: shown } = session.getSnapshot();
    expect(shown?.lines).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(shown?.hidden).toBeGreaterThan(400);

    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('starts a fresh console with every run', async () => {
    const session = createRunSession(registry);
    session.start(document(program([print(text('first'))])));
    await vi.advanceTimersByTimeAsync(0);
    session.start(document(program([print(text('second'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().console?.lines).toEqual(['second']);
  });

  it('keeps the run state out of the document', async () => {
    const session = createRunSession(registry);
    const project = document(program([setVar('x', num(5)), print(getVar('x'))]));
    const before = structuredClone(project);

    session.start(project);
    await vi.advanceTimersByTimeAsync(0);

    expect(project).toEqual(before);
    expect(JSON.stringify(project)).not.toMatch(/console|hidden|"status"/);
    expect(Object.keys(project).sort()).toEqual(['circuit', 'id', 'name', 'profile', 'program', 'schemaVersion']);
  });
});

describe('RunSession, profile and family', () => {
  it('refuses language blocks that the project profile does not show (fixture profile test-base)', () => {
    const { registry: fixtureRegistry, profiles, packs } = createFixtureEnvironment();
    const session = createRunSession(fixtureRegistry, { profiles, packs });

    const result = session.start(document(program([print(num(1))]), 'test-base'));
    expect(result).toMatchObject({ ok: false, reason: 'compile-error' });
    expect(result.ok === false && result.diagnostics.every((d) => d.code === 'not-in-profile')).toBe(true);
  });

  it('does not give a generic run a console: its snapshots keep their old shape', async () => {
    const session = createRunSession(registry);
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    session.start(createTemplateProject('blink'));
    await vi.advanceTimersByTimeAsync(2_000);
    session.stop();

    expect(published.length).toBeGreaterThan(2);
    expect(published.every((snapshot) => !Object.hasOwn(snapshot, 'console'))).toBe(true);
  });

  it('does not run YB-2a blocks in a generic project', () => {
    const generic = { ...createTemplateProject('led-on'), program: { blocks: program([print(num(1))]) } };
    const result = createRunSession(registry).start(generic);
    expect(result).toMatchObject({ ok: false, reason: 'compile-error' });
    expect(result.ok === false && result.diagnostics.every((d) => d.code === 'not-in-profile')).toBe(true);
  });
});
