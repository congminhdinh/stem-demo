import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ButtonIO } from '../capabilities/io';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import type { ComponentInput } from '../simulation/simulate-circuit';
import { boardId, seamDocument, seamProfiles, seamRegistry, ybcBoard } from './__fixtures__/seam-fixtures';
import { createRunSession, type RunEnvironment } from './run-session';

// YB-CP amendment 1, C-13: the press history `get_presses` needs. Contract §5: it returns the presses since the
// last read (or since the start of the program), then counts from 0 again; the simulator counts at the press-down
// edge, and a press during a `sleep` still counts (EVD-09, EVD-17, EVD-25). The history is state of the run, pulled
// by the capability: there is no event, queue or callback here. The capability below is a test double.

const buttonA = `${boardId}/button-a`;
const buttonB = `${boardId}/button-b`;
const hold = (closed: boolean): ComponentInput => ({ kind: 'hold', closed });
/** A program that keeps running, so the run stays alive while the test presses. */
const ybc = () => seamDocument();

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const environments: RunEnvironment[] = [];
  const session = createRunSession(seamRegistry, {
    profiles: seamProfiles,
    capabilities: (environment) => {
      environments.push(environment);
      return {};
    },
  });
  return { session, environments, env: (index = 0) => environments[index] as RunEnvironment };
}

describe('takePresses counts the edge from open to closed, and nothing else', () => {
  it('is 0 before anything is pressed', () => {
    const { session, env } = setup();
    session.start(ybc());
    expect(env().takePresses(buttonA)).toBe(0);
    expect(env().takePresses(buttonB)).toBe(0);
    session.stop();
  });

  it.each<[string, boolean[], number]>([
    ['an open part set open again (initial false, false → false)', [false], 0],
    ['open → closed', [true], 1],
    ['closed → closed', [true, true], 1],
    ['closed → open', [true, false], 1],
    ['open → closed → open → closed', [true, false, true], 2],
    ['closed → closed → open → open → closed', [true, true, false, false, true], 2],
    ['six clicks', [true, false, true, false, true, false, true, false, true, false, true, false], 6],
  ])('%s', (_label, steps, expected) => {
    const { session, env } = setup();
    session.start(ybc());
    for (const closed of steps) {
      session.setComponentInput(buttonA, hold(closed));
    }
    expect(env().takePresses(buttonA)).toBe(expected);
    session.stop();
  });
});

describe('a press is the edge, not a new object', () => {
  it('does not count a closed part that is set closed again with another shape of the same input', () => {
    const { session, env } = setup();
    session.start(ybc());
    // `isComponentInput` accepts a hold with extra fields, and such an input differs from the one kept; it is no new press.
    session.setComponentInput(buttonA, { kind: 'hold', closed: true });
    session.setComponentInput(buttonA, { kind: 'hold', closed: true, source: 'keyboard' } as never);
    expect(env().takePresses(buttonA)).toBe(1);
    session.stop();
  });
});

describe('takePresses reads and resets (contract C-13)', () => {
  it('gives 3 for three full clicks before the first read, then 0 (EVD-25: print twice → 3, 0)', () => {
    const { session, env } = setup();
    session.start(ybc());
    for (let click = 0; click < 3; click += 1) {
      session.setComponentInput(buttonA, hold(true));
      session.setComponentInput(buttonA, hold(false));
    }
    expect(env().takePresses(buttonA)).toBe(3);
    expect(env().takePresses(buttonA)).toBe(0);
    session.stop();
  });

  it('counts a part that is still held once: 1, then 0, and a held part is not pressed again (EVD-17)', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    expect(env().takePresses(buttonA)).toBe(1);
    expect(env().takePresses(buttonA)).toBe(0);
    session.setComponentInput(buttonA, hold(true));
    expect(env().takePresses(buttonA)).toBe(0);
    // Release is not a press; the next press after it is.
    session.setComponentInput(buttonA, hold(false));
    expect(env().takePresses(buttonA)).toBe(0);
    session.setComponentInput(buttonA, hold(true));
    expect(env().takePresses(buttonA)).toBe(1);
    session.stop();
  });

  it('counts from the last read, not from the start of the run, and keeps the part pressed in between', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(buttonA, hold(false));
    expect(env().takePresses(buttonA)).toBe(1);
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(buttonA, hold(false));
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(buttonA, hold(false));
    expect(env().takePresses(buttonA)).toBe(2);
    session.stop();
  });

  it('keeps A and B apart', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(buttonB, hold(true));
    session.setComponentInput(buttonA, hold(false));
    session.setComponentInput(buttonA, hold(true));
    expect(env().takePresses(buttonB)).toBe(1);
    expect(env().takePresses(buttonA)).toBe(2);
    expect(env().takePresses(buttonB)).toBe(0);
    session.stop();
  });

  it('keeps every press that began and ended between two polls of a capability, which the latest value cannot show (EVD-09)', () => {
    const { session, env } = setup();
    session.start(ybc());
    // What YB-3 will write: `isPressed` is the latest value, `takePresses` the history, both of the same run.
    const buttons: ButtonIO = {
      isPressed: (id) => {
        const input = env().input(`${boardId}/button-${id}`);
        return input?.kind === 'hold' && input.closed;
      },
      takePresses: (id) => env().takePresses(`${boardId}/button-${id}`),
    };
    for (let click = 0; click < 3; click += 1) {
      session.setComponentInput(buttonA, hold(true));
      session.setComponentInput(buttonA, hold(false));
    }
    expect(buttons.isPressed('a')).toBe(false);
    expect(buttons.takePresses?.('a')).toBe(3);
    expect(buttons.takePresses?.('a')).toBe(0);
    session.stop();
  });
});

describe('what is not a press of a part counts nothing', () => {
  it('ignores a part with another kind of control, a part that is not there, another board, the wrong kind and a malformed input', () => {
    const { session, env } = setup();
    session.start(ybc());
    const attempts: [string, unknown][] = [
      [`${boardId}/light`, hold(true)],
      [`${boardId}/display`, hold(true)],
      [`${boardId}/buzzer`, hold(true)],
      [`${boardId}/nothing`, hold(true)],
      ['another-board/button-a', hold(true)],
      ['button-a', hold(true)],
      [buttonA, { kind: 'slider', value: 1 }],
      [buttonA, { kind: 'gesture' }],
      [buttonA, { kind: 'hold', closed: 'yes' }],
      [buttonA, null],
    ];
    for (const [id, input] of attempts) {
      session.setComponentInput(id, input as never);
    }
    for (const [id] of attempts) {
      expect(env().takePresses(id), id).toBe(0);
    }
    expect(env().takePresses('constructor')).toBe(0);
    expect(env().takePresses('__proto__')).toBe(0);
    session.stop();
  });

  it('lets the circuit win an id that is also an onboard part: that contact is closed, and no press of the part is made', () => {
    const { session, env } = setup();
    // A push button of the circuit that is called like the board's button A.
    const document = seamDocument([ybcBoard, { id: buttonA, deviceType: 'test-ybc-button', position: { x: 100, y: 100 } }]);
    expect(session.start(document)).toEqual({ ok: true });
    session.setComponentInput(buttonA, hold(true));
    expect(session.getSnapshot().simulation?.components[buttonA]).toEqual({ closed: true });
    expect(env().input(buttonA)).toBeUndefined();
    expect(env().takePresses(buttonA)).toBe(0);
    // The board's other button is still the part.
    session.setComponentInput(buttonB, hold(true));
    expect(env().takePresses(buttonB)).toBe(1);
    session.stop();
  });

  it('does not count while idle: a press before the run starts is lost, as an input to a run that is not there', () => {
    const { session, env } = setup();
    session.setComponentInput(buttonA, hold(true));
    session.start(ybc());
    expect(env().takePresses(buttonA)).toBe(0);
    session.stop();
  });
});

describe('the presses belong to their run', () => {
  it('starts a replacing run from 0, and the old run neither reads nor consumes the new one', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(buttonA, hold(false));

    session.start(ybc());
    expect(env(1).takePresses(buttonA)).toBe(0);
    // The old run's press is gone with it, and the old environment reads nothing.
    expect(env(0).takePresses(buttonA)).toBe(0);

    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(buttonA, hold(false));
    // The stale environment cannot take the new run's press: it is still there for the run that owns it.
    expect(env(0).takePresses(buttonA)).toBe(0);
    expect(env(1).takePresses(buttonA)).toBe(1);
    session.stop();
  });

  it('forgets a part that was held when the run was replaced: the new run begins open, so its first press counts', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    session.start(ybc());
    expect(env(1).input(buttonA)).toBeUndefined();
    session.setComponentInput(buttonA, hold(true));
    expect(env(1).takePresses(buttonA)).toBe(1);
    session.stop();
  });

  it('drops them on Stop, for the run and for a later one', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    session.stop();
    expect(env(0).takePresses(buttonA)).toBe(0);

    session.start(ybc());
    expect(env(1).takePresses(buttonA)).toBe(0);
    session.stop();
  });

  it('does not count into a run that failed to start, and does not keep presses of the run it replaced', () => {
    const { session, env } = setup();
    session.start(ybc());
    session.setComponentInput(buttonA, hold(true));
    // A document with no board stops the run and leaves the session idle.
    expect(session.start(fixtureDocument('ybc-basic', { components: [] }))).toMatchObject({ ok: false, reason: 'no-board' });
    session.setComponentInput(buttonA, hold(true));
    expect(env().takePresses(buttonA)).toBe(0);
    session.start(ybc());
    expect(env(1).takePresses(buttonA)).toBe(0);
    session.stop();
  });
});
