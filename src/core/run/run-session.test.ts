import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { projectDocumentSchema, type ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import orphanBlock from '../program/__fixtures__/orphan-block.json';
import { createRunSession, type RunSnapshot } from './run-session';

// Headless core loop (plan POC-07): document → compile → interpreter →
// HardwareIO → simulation → snapshot, on fake time.

const registry = createDeviceRegistry(localDeviceDefinitions);
const ledOn = projectDocumentSchema.parse(ledOnSample);
const blink = projectDocumentSchema.parse(blinkSample);
const unknownPin: ProjectDocument = {
  ...ledOn,
  program: { blocks: JSON.parse(JSON.stringify(ledOn.program.blocks).replace('"D13"', '"D99"')) },
};
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };
const lit = (snapshot: RunSnapshot) => snapshot.simulation?.components.led?.lit;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RunSession', () => {
  it('runs the led-on sample: the LED lights and stays lit after the program finishes (Minimum Proof)', async () => {
    const session = createRunSession(registry);

    expect(session.start(ledOn)).toEqual({ ok: true });
    // E1: the board is powered before the program writes its first pin.
    expect(session.getSnapshot().status).toBe('running');
    expect(lit(session.getSnapshot())).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', error: null });
    expect(lit(session.getSnapshot())).toBe(true);

    // E6: a finished program leaves the board powered and the pins as written.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lit(session.getSnapshot())).toBe(true);

    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('blinks the blink sample: the LED changes at 0, 1000, 2010, 3010… ms (E3, E4)', async () => {
    const session = createRunSession(registry);
    const startedAt = Date.now();
    const changes: [number, boolean | undefined][] = [];
    session.subscribe((snapshot) => {
      if (changes.at(-1)?.[1] !== lit(snapshot)) {
        changes.push([Date.now() - startedAt, lit(snapshot)]);
      }
    });

    session.start(blink);
    await vi.advanceTimersByTimeAsync(5000);

    expect(changes).toEqual([
      [0, false],
      [0, true],
      [1000, false],
      [2010, true],
      [3010, false],
      [4020, true],
    ]);
    expect(session.getSnapshot().status).toBe('running');
  });

  it('stops at once during a wait and publishes nothing afterwards (E5)', async () => {
    const session = createRunSession(registry);
    session.start(blink);
    await vi.advanceTimersByTimeAsync(500);
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));

    session.stop();

    expect(session.getSnapshot()).toEqual(idle);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(published).toEqual([idle]);
  });

  it.each<[string, ProjectDocument, object]>([
    [
      'a program that does not compile',
      unknownPin,
      {
        reason: 'compile-error',
        diagnostics: [expect.objectContaining({ code: 'unknown-pin', blockId: 'write-d13-high' })],
      },
    ],
    [
      'a circuit without a board',
      { ...ledOn, circuit: { components: ledOn.circuit.components.filter(({ id }) => id !== 'board'), wires: [] } },
      { reason: 'no-board', diagnostics: [] },
    ],
    [
      'a circuit with two boards',
      {
        ...ledOn,
        circuit: {
          ...ledOn.circuit,
          components: [...ledOn.circuit.components, { id: 'board-2', deviceType: 'board', position: { x: 200, y: 600 } }],
        },
      },
      { reason: 'multiple-boards', diagnostics: [] },
    ],
  ])('refuses to start %s and creates no runtime', async (_, project, failure) => {
    const session = createRunSession(registry);
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));

    expect(session.start(project)).toEqual({ ok: false, ...failure });

    await vi.advanceTimersByTimeAsync(5000);
    expect(published).toEqual([]);
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('keeps compile warnings in the snapshot of a running program', () => {
    const session = createRunSession(registry);

    session.start({ ...ledOn, program: { blocks: orphanBlock } });

    expect(session.getSnapshot().diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'ignored-block', blockId: 'orphan-write' }),
    ]);
  });

  it('publishes only when a pin changes level, not on every write', async () => {
    const session = createRunSession(registry);
    const foreverHigh = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'stem_forever',
            id: 'forever',
            inputs: { DO: { block: { type: 'stem_digital_write', id: 'write', fields: { PIN: 'D13', LEVEL: 'HIGH' } } } },
          },
        ],
      },
    };
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));

    session.start({ ...ledOn, program: { blocks: foreverHigh } });
    await vi.advanceTimersByTimeAsync(1000);

    // ~100 forever iterations: the power-up snapshot and the first write only.
    expect(published.map(lit)).toEqual([false, true]);
  });

  it('stays idle when stopped before a finished program reports back', async () => {
    const session = createRunSession(registry);

    session.start(ledOn);
    queueMicrotask(() => session.stop());
    await vi.advanceTimersByTimeAsync(0);

    expect(session.getSnapshot()).toEqual(idle);
  });

  it('runs again after start → stop → start; the stopped run never writes into the new one', async () => {
    const session = createRunSession(registry);
    session.start(blink);
    await vi.advanceTimersByTimeAsync(500);
    session.stop();

    session.start(ledOn);
    await vi.advanceTimersByTimeAsync(5000);

    // The stopped blink would have turned the LED off at 1000 ms.
    expect(session.getSnapshot().status).toBe('finished');
    expect(lit(session.getSnapshot())).toBe(true);
  });

  it('replaces the current run when started while running', async () => {
    const session = createRunSession(registry);
    session.start(ledOn);
    await vi.advanceTimersByTimeAsync(0);

    session.start(blink);
    await vi.advanceTimersByTimeAsync(1500);

    expect(session.getSnapshot().status).toBe('running');
    expect(lit(session.getSnapshot())).toBe(false);
  });

  describe('when a listener starts or stops the session itself', () => {
    /** A session whose led-on run finished, so the next start has a run to replace. */
    const sessionWithFinishedRun = async () => {
      const session = createRunSession(registry);
      session.start(ledOn);
      await vi.advanceTimersByTimeAsync(0);
      return session;
    };

    it.each<[string, ProjectDocument, (snapshot: RunSnapshot) => boolean]>([
      ['on the first snapshot of a start that replaces a run', blink, () => true],
      ['while the outer run writes a pin', blink, (snapshot) => snapshot.status === 'running' && lit(snapshot) === true],
      ['on the idle snapshot of a start that fails', unknownPin, (snapshot) => snapshot.status === 'idle'],
    ])('lets a start made %s win, and the outer run never comes back', async (_, outer, when) => {
      const session = await sessionWithFinishedRun();
      const published: RunSnapshot[] = [];
      let nested = false;
      session.subscribe((snapshot) => {
        published.push(snapshot);
        if (!nested && when(snapshot)) {
          nested = true;
          session.start(ledOn);
        }
      });

      session.start(outer);
      await vi.advanceTimersByTimeAsync(5000);

      expect(nested).toBe(true);
      expect(session.getSnapshot().status).toBe('finished');
      expect(lit(session.getSnapshot())).toBe(true);
      // The outer blink would still have a wait pending and would keep publishing.
      expect(vi.getTimerCount()).toBe(0);
      expect(published.slice(published.findIndex((snapshot) => snapshot.status === 'finished') + 1)).toEqual([]);
    });

    it('lets a stop made on the first snapshot of a start win', async () => {
      const session = await sessionWithFinishedRun();
      let nested = false;
      session.subscribe(() => {
        if (!nested) {
          nested = true;
          session.stop();
        }
      });

      session.start(blink);
      await vi.advanceTimersByTimeAsync(5000);

      expect(nested).toBe(true);
      expect(session.getSnapshot()).toEqual(idle);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('publishes plain JSON snapshots and leaves the document unchanged (B2)', async () => {
    const session = createRunSession(registry);
    const document = structuredClone(blink);
    const before = structuredClone(document);
    const snapshots: RunSnapshot[] = [];
    const unsubscribe = session.subscribe((snapshot) => snapshots.push(snapshot));

    session.start(document);
    await vi.advanceTimersByTimeAsync(3000);
    session.stop();
    unsubscribe();
    session.start(document);

    expect(document).toStrictEqual(before);
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual(['running', 'running', 'running', 'running', 'idle']);
    for (const snapshot of snapshots) {
      expect(JSON.parse(JSON.stringify(snapshot))).toStrictEqual(snapshot);
    }
  });
});
