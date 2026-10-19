import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import type { Frame } from '../capabilities/frame';
import type { Capabilities } from '../capabilities/io';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import {
  acceleration, clearDisplay, gestureIs, ifThen, images, num, print, program, showImage, temperature, wait, type ImageRows, type Json,
} from '../program/__fixtures__/ybc-blocks';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import type { ComponentInput } from '../simulation/simulate-circuit';
import { createRunSession, type CapabilityFactory, type RunEnvironment, type RunSession } from './run-session';

// N17 B2: the temperature sensor and the accelerometer through the production path: an Advanced document with the ybc-board, a
// real RunSession and the production factory; fake timers drive the time. A run starts at 25 °C, lying flat face up
// (0, 0, −1024 mg); the controls send a slider (temperature), a tilt (the pad) and a gesture (the "Lắc" button). A shake is true
// for 1 s and never replaces the tilt.

const registry = createDeviceRegistry(localDeviceDefinitions);
const boardId = 'ybc-board-1';
const part = (name: string) => `${boardId}/${name}`;
const temperaturePart = part('temperature');
const accelerometerPart = part('accelerometer');
const shake: ComponentInput = { kind: 'gesture' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const document = (blocks: Json, profile = 'ybc-advanced'): ProjectDocument => fixtureDocument(profile, { blocks });

function setup() {
  const environments: RunEnvironment[] = [];
  const capabilities: Capabilities[] = [];
  const factory: CapabilityFactory = (environment) => {
    environments.push(environment);
    const made = createOnboardCapabilities(environment);
    capabilities.push(made);
    return made;
  };
  return { session: createRunSession(registry, { capabilities: factory }), environments, capabilities };
}

const redFrame = (rows: ImageRows | readonly string[]): Frame => ({ pixels: [...rows.join('')].map((digit) => (digit === '1' ? '#FF0000' : null)) });
const blank = redFrame(['00000', '00000', '00000', '00000', '00000']);
const frameOf = (session: RunSession): Frame | undefined => session.getSnapshot().simulation?.components[part('display')]?.frame;
const linesOf = (session: RunSession) => session.getSnapshot().console?.lines ?? [];

/** Prints every reading once: the temperature, x, y, z and two gestures. */
const printAll = [
  print(temperature()),
  print(acceleration('x')),
  print(acceleration('y')),
  print(acceleration('z')),
  print(gestureIs('face_up')),
  print(gestureIs('shake')),
];

describe('the readings at the start of a run (plan N17: 25 °C, lying flat)', () => {
  it('are 25 °C and (0, 0, −1024) mg, face up and not shaken, before any control is touched', async () => {
    const { session } = setup();
    expect(session.start(document(program(printAll)))).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['25', '0', '0', '-1024', 'True', 'False']);
    session.stop();
  });

  it('are the defaults again in the next run: a reading belongs to its run (B2)', async () => {
    const { session } = setup();
    session.start(document(program([], [print(temperature()), wait(num(100))])));
    session.setComponentInput(temperaturePart, { kind: 'slider', value: 40 });
    session.setComponentInput(accelerometerPart, { kind: 'tilt', x: -800, y: 0 });
    session.setComponentInput(accelerometerPart, shake);
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session).at(-1)).toBe('40');
    session.stop();

    session.start(document(program(printAll)));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['25', '0', '0', '-1024', 'True', 'False']);
    session.stop();
  });
});

describe('the program reads what the controls send, at the moment it reads', () => {
  it('reads the temperature slider: 30, then −10, each at the next read', async () => {
    const { session } = setup();
    session.start(document(program([], [print(temperature()), wait(num(100))])));
    await vi.advanceTimersByTimeAsync(0);
    session.setComponentInput(temperaturePart, { kind: 'slider', value: 30 });
    await vi.advanceTimersByTimeAsync(110);
    session.setComponentInput(temperaturePart, { kind: 'slider', value: -10 });
    await vi.advanceTimersByTimeAsync(110);
    expect(linesOf(session)).toEqual(['25', '30', '-10']);
    session.stop();
  });

  it('reads the tilt pad on every axis, and the gesture it makes', async () => {
    const { session } = setup();
    session.start(document(program([], [...printAll, wait(num(100))])));
    await vi.advanceTimersByTimeAsync(0);
    session.setComponentInput(accelerometerPart, { kind: 'tilt', x: -700, y: 300 });
    await vi.advanceTimersByTimeAsync(110);
    expect(linesOf(session).slice(6)).toEqual(['25', '-700', '300', '-685', 'False', 'False']);
    session.setComponentInput(accelerometerPart, { kind: 'tilt', x: 0, y: 0, z: 1024 });
    await vi.advanceTimersByTimeAsync(110);
    expect(linesOf(session).slice(12)).toEqual(['25', '0', '0', '1024', 'False', 'False']);
    session.stop();
  });

  it('ignores an input of the wrong kind for a sensor (a tilt to the temperature, a slider to the accelerometer)', async () => {
    const { session } = setup();
    session.start(document(program([], [print(temperature()), print(acceleration('x')), wait(num(100))])));
    session.setComponentInput(temperaturePart, { kind: 'tilt', x: 5, y: 5 });
    session.setComponentInput(accelerometerPart, { kind: 'slider', value: 7 });
    session.setComponentInput(temperaturePart, { kind: 'hold', closed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['25', '0']);
    session.stop();
  });
});

describe('a shake (the "Lắc" button)', () => {
  /** Shows the full picture while the board is shaken, and clears it otherwise. */
  const shakeShows = program([], [ifThen(gestureIs('shake'), [showImage(images.FULL)], [clearDisplay()])]);

  it('is true for 1 s after it is given, then false again (fake timers)', async () => {
    const { session } = setup();
    session.start(document(shakeShows));
    await vi.advanceTimersByTimeAsync(300);
    expect(frameOf(session)).toEqual(blank);

    session.setComponentInput(accelerometerPart, shake);
    await vi.advanceTimersByTimeAsync(20);
    expect(frameOf(session)).toEqual(redFrame(images.FULL));
    await vi.advanceTimersByTimeAsync(960);
    expect(frameOf(session)).toEqual(redFrame(images.FULL));
    await vi.advanceTimersByTimeAsync(40);
    expect(frameOf(session)).toEqual(blank);
    session.stop();
  });

  it('starts its second again: a shake within the first keeps it true for 1 s from the second', async () => {
    const { session } = setup();
    session.start(document(shakeShows));
    session.setComponentInput(accelerometerPart, shake);
    await vi.advanceTimersByTimeAsync(800);
    session.setComponentInput(accelerometerPart, shake);
    await vi.advanceTimersByTimeAsync(900);
    expect(frameOf(session)).toEqual(redFrame(images.FULL));
    await vi.advanceTimersByTimeAsync(120);
    expect(frameOf(session)).toEqual(blank);
    session.stop();
  });

  it('does not replace the tilt: after the shake the board is still tilted left', async () => {
    const { session } = setup();
    session.start(document(program([], [print(acceleration('x')), print(gestureIs('tilt_left')), print(gestureIs('shake')), wait(num(500))])));
    session.setComponentInput(accelerometerPart, { kind: 'tilt', x: -700, y: 0 });
    session.setComponentInput(accelerometerPart, shake);
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['-700', 'False', 'True']);
    await vi.advanceTimersByTimeAsync(1100);
    expect(linesOf(session).slice(-3)).toEqual(['-700', 'True', 'False']);
    session.stop();
  });

  it('is nothing while idle, and nothing for the next run: a shake belongs to its run', async () => {
    const { session } = setup();
    session.setComponentInput(accelerometerPart, shake);
    session.start(document(program([print(gestureIs('shake'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['False']);
    session.setComponentInput(accelerometerPart, shake);
    session.stop();

    session.start(document(program([print(gestureIs('shake'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['False']);
    session.stop();
  });

  it('is only the accelerometer’s: a gesture sent to another part changes nothing', async () => {
    const { session } = setup();
    session.start(document(program([], [print(gestureIs('shake')), wait(num(100))])));
    session.setComponentInput(temperaturePart, shake);
    session.setComponentInput(part('button-a'), shake);
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['False']);
    session.stop();
  });

  it('cannot reach a later run through a capability of an earlier one (YB-CP amendment 1)', async () => {
    const { session, environments, capabilities } = setup();
    session.start(document(program([print(gestureIs('shake'))])));
    await vi.advanceTimersByTimeAsync(0);
    const [stale] = capabilities;
    const [staleEnvironment] = environments;
    session.start(document(program([], [wait(num(100))])));
    session.setComponentInput(accelerometerPart, shake);
    expect(stale?.motion?.gesture?.()).toBe('face_up');
    expect(staleEnvironment?.sinceEvent(accelerometerPart)).toBeUndefined();
    expect(environments[1]?.sinceEvent(accelerometerPart)).toBe(0);
    session.stop();
  });
});

describe('the profiles', () => {
  it('refuse the sensor blocks in a Basic project: they belong to the Advanced board', () => {
    const { session } = setup();
    for (const block of [temperature(), acceleration('x'), gestureIs('shake')]) {
      const started = session.start(document(program([print(block)]), 'ybc-basic'));
      expect(started.ok, String(block.type)).toBe(false);
      expect(started.ok ? [] : started.diagnostics.map((diagnostic) => diagnostic.code), String(block.type)).toEqual(['not-in-profile']);
    }
  });
});
