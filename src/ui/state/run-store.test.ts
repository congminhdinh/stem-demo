import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectDocumentSchema } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { fixtureDocument } from '../../core/profiles/__fixtures__/test-profiles';
import { buttonPressed, clearDisplay, cmp, ifThen, images, lightLevel, num, playNote, program, showImage } from '../../core/program/__fixtures__/ybc-blocks';
import { createRunSession } from '../../core/run/run-session';
import { createOnboardCapabilities } from '../../core/simulation/peripherals/onboard-capabilities';
import buttonDirectSample from '../../samples/button-direct.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { createRunStore, selectIsRunning } from './run-store';

const registry = createDeviceRegistry(localDeviceDefinitions);
const ledOn = projectDocumentSchema.parse(ledOnSample);

/** A runStore whose animation frames run only when the test says so. */
function setup() {
  const session = createRunSession(registry);
  const frames: (() => void)[] = [];
  const store = createRunStore(session, (callback) => frames.push(callback));
  const renderFrame = () => frames.splice(0).forEach((callback) => callback());
  return { session, store, frames, renderFrame };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('runStore', () => {
  it('hands React at most one snapshot per animation frame: the latest', async () => {
    const { session, store, frames, renderFrame } = setup();
    let snapshotUpdates = 0;
    store.subscribe((state, previous) => {
      if (state.snapshot !== previous.snapshot) {
        snapshotUpdates++;
      }
    });

    store.getState().run(ledOn);
    await vi.advanceTimersByTimeAsync(0);

    // Running, the D13 write and finished were published within one frame.
    expect(session.getSnapshot().status).toBe('finished');
    expect(store.getState().snapshot.status).toBe('idle');
    expect(frames).toHaveLength(1);

    renderFrame();
    expect(store.getState().snapshot).toBe(session.getSnapshot());
    expect(snapshotUpdates).toBe(1);
  });

  it('keeps why a Run did not start until a Run starts', () => {
    const { store } = setup();
    const unknownPin = {
      ...ledOn,
      program: { blocks: JSON.parse(JSON.stringify(ledOn.program.blocks).replace('"D13"', '"D99"')) },
    };

    store.getState().run(unknownPin);
    expect(store.getState().startFailure).toMatchObject({ ok: false, reason: 'compile-error' });

    store.getState().run(ledOn);
    expect(store.getState().startFailure).toBeNull();
  });

  it('forgets why a Run did not start on clearStartFailure, without touching the session', () => {
    const { session, store, frames } = setup();
    store.getState().run({ ...ledOn, circuit: { components: [], wires: [] } });
    expect(store.getState().startFailure).toMatchObject({ ok: false, reason: 'no-board' });

    store.getState().clearStartFailure();

    expect(store.getState().startFailure).toBeNull();
    expect(session.getSnapshot().status).toBe('idle');
    expect(selectIsRunning(store.getState())).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('hands a push button press to the session; React sees it on the next frame', () => {
    const { session, store, renderFrame } = setup();
    store.getState().run(projectDocumentSchema.parse(buttonDirectSample));

    store.getState().setContactInput('button', true);
    expect(session.getSnapshot().simulation?.components.led).toEqual({ lit: true });

    renderFrame();
    expect(store.getState().snapshot.simulation?.components).toMatchObject({
      button: { closed: true },
      led: { lit: true },
    });
  });

  it('hands a component input to the session, like a held contact', () => {
    const { session, store, renderFrame } = setup();
    store.getState().run(projectDocumentSchema.parse(buttonDirectSample));

    store.getState().setComponentInput('button', { kind: 'hold', closed: true });
    expect(session.getSnapshot().simulation?.components.led).toEqual({ lit: true });

    store.getState().setComponentInput('button', { kind: 'hold', closed: false });
    renderFrame();
    expect(store.getState().snapshot.simulation?.components).toMatchObject({ button: { closed: false }, led: { lit: false } });
  });

  it('hands an onboard part its input: a held button and a light level reach the program, and the display shows the result', async () => {
    const session = createRunSession(registry, { capabilities: createOnboardCapabilities });
    const frames: (() => void)[] = [];
    const store = createRunStore(session, (callback) => frames.push(callback));
    const renderFrame = () => frames.splice(0).forEach((callback) => callback());
    const boardId = 'ybc-board-1';
    // Lights the whole display while button A is held or the light is above 80, and clears it otherwise.
    const blocks = program(
      [],
      [
        ifThen(buttonPressed('A'), [showImage(images.FULL)], [
          ifThen(cmp('GT', lightLevel(), num(80)), [showImage(images.FULL)], [clearDisplay()]),
        ]),
      ],
    );
    const litCells = () =>
      store
        .getState()
        .snapshot.simulation?.components[`${boardId}/display`]?.frame?.pixels.filter((pixel) => pixel !== null).length;
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(100);
      renderFrame();
    };

    store.getState().run(fixtureDocument('ybc-basic', { blocks }));
    await settle();
    expect(litCells()).toBe(0);

    store.getState().setComponentInput(`${boardId}/button-a`, { kind: 'hold', closed: true });
    await settle();
    expect(litCells()).toBe(25);

    store.getState().setComponentInput(`${boardId}/button-a`, { kind: 'hold', closed: false });
    await settle();
    expect(litCells()).toBe(0);

    store.getState().setComponentInput(`${boardId}/light`, { kind: 'slider', value: 90 });
    await settle();
    expect(litCells()).toBe(25);

    // Inputs belong to the run: after Stop the part has none, and nothing reaches an idle session.
    store.getState().stop();
    store.getState().setComponentInput(`${boardId}/light`, { kind: 'slider', value: 10 });
    renderFrame();
    expect(store.getState().snapshot.simulation).toBeNull();
  });

  it('tells the sound every change of the buzzer as it happens, though a frame shows only the last snapshot (two notes of one pitch)', async () => {
    const session = createRunSession(registry, { capabilities: createOnboardCapabilities });
    const frames: (() => void)[] = [];
    const store = createRunStore(session, (callback) => frames.push(callback));
    const buzzer = 'ybc-board-1/buzzer';
    const toneOf = (snapshot: { simulation: { components: Record<string, { hz?: number }> } | null }) =>
      snapshot.simulation && Object.hasOwn(snapshot.simulation.components, buzzer) ? snapshot.simulation.components[buzzer]?.hz : undefined;
    const heard: (number | undefined)[] = [];
    const stopListening = store.getState().onSnapshot((snapshot) => heard.push(toneOf(snapshot)));
    const drawn: (number | undefined)[] = [];
    const draw = () => {
      frames.splice(0).forEach((callback) => callback());
      drawn.push(toneOf(store.getState().snapshot));
    };

    // Two notes of one pitch, 125 ms each: the core ends the first and starts the second inside one task.
    store.getState().run(fixtureDocument('ybc-basic', { blocks: program([playNote('C4', 1), playNote('C4', 1)]) }));
    for (let step = 0; step < 6; step += 1) {
      await vi.advanceTimersByTimeAsync(50);
      draw();
    }

    // The sound is told of the silence between the notes: 262, silent, 262, silent.
    const changes = heard.filter((hz, index) => hz !== heard[index - 1]);
    expect(changes.filter((hz) => hz === 262)).toHaveLength(2);
    expect(changes.indexOf(undefined, changes.indexOf(262))).toBeGreaterThan(changes.indexOf(262));
    expect(changes.slice(changes.indexOf(262), changes.indexOf(262) + 3)).toEqual([262, undefined, 262]);
    // A frame never saw it: the throttled snapshot has the tone on, and later off, with no gap in between at the join.
    expect(drawn.join()).not.toContain('262,,262');

    // After Stop nothing is heard any more, and a listener that stopped listening is not told.
    store.getState().stop();
    expect(heard.at(-1)).toBeUndefined();
    stopListening();
    const count = heard.length;
    store.getState().run(fixtureDocument('ybc-basic', { blocks: program([playNote('A4', 1)]) }));
    await vi.advanceTimersByTimeAsync(10);
    expect(heard).toHaveLength(count);
    store.getState().stop();
  });

  it('counts a finished program as running until Stop (the board stays powered)', async () => {
    const { store, renderFrame } = setup();
    expect(selectIsRunning(store.getState())).toBe(false);

    store.getState().run(ledOn);
    await vi.advanceTimersByTimeAsync(0);
    renderFrame();
    expect(store.getState().snapshot.status).toBe('finished');
    expect(selectIsRunning(store.getState())).toBe(true);

    store.getState().stop();
    renderFrame();
    expect(selectIsRunning(store.getState())).toBe(false);
  });

  it('switches the edit lock at once on Run and on Stop, without waiting for a frame', () => {
    const { store, frames } = setup();

    store.getState().run(ledOn);
    expect(selectIsRunning(store.getState())).toBe(true);
    expect(store.getState().snapshot.status).toBe('idle'); // the snapshot still waits for its frame

    store.getState().stop();
    expect(selectIsRunning(store.getState())).toBe(false);
    expect(frames).toHaveLength(1);
  });
});
