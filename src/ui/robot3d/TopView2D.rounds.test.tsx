// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unoR3Board } from '../../core/hardware/catalog';
import type { Scenario } from '../../core/scenario/scenario';
import { variantObjectColors } from '../../core/scenario/variants';
import { parseArena } from '../../core/world/arena/arena-schema';
import { bodyPalette } from '../../core/world/arena/body-colors';
import { TextProvider } from '../i18n/text';
import { gripperKit, gripperTestScenario } from './__fixtures__/gripper-scene';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { TopView2D } from './TopView2D';
import { readTopViewGripper } from './top-view-gripper-state';
import { readTopViewSensors } from './top-view-sensors-state';
import { readTopViewState } from './top-view-state';

// N19 E4/E5 (ruling 8 on the E4/E5 report): the 2D map paints each object in the colour of the round it shows, the run's world's
// (`objectColors` of the run's snapshot, robot-run-session.object-colors.test.ts), with that colour's mark: the sort lesson's cube is green
// in round 1, red in round 2, blue in round 3, and green again when nothing is run. The map draws nothing more for it at rest.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The sort lesson's shape: one cube, green, red, blue in the three rounds. */
const scenario: Scenario = {
  ...gripperTestScenario,
  arena: parseArena({ ...gripperTestScenario.arena, objects: [{ shape: 'box', id: 'cube', centerCm: [60, 30], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.green }] }),
  variants: { ...gripperTestScenario.variants, count: 3, objectColors: { cube: [bodyPalette.green, bodyPalette.red, bodyPalette.blue] } },
};

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  installFakeCanvas2d();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The store's frames by hand (HeldChip.test.tsx's): the store commits the latest snapshot to React once a frame. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    requestFrame: (callback: (now: number) => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelFrame: (handle: number) => void pending.delete(handle),
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

function mount(on: Scenario = scenario) {
  const fake = fakeSession(on, gripperKit);
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  store.getState().connect();
  const renders: number[] = [];
  act(() =>
    root.render(
      <TextProvider locale="vi">
        <Profiler id="map" onRender={() => void renders.push(renders.length)}>
          <TopView2D scenario={on} kit={gripperKit} model={robotModel(gripperKit, unoR3Board)} store={store} zoneLabel={() => null} reason="no-webgl" />
        </Profiler>
      </TextProvider>,
    ),
  );
  let now = 0;
  // A publish, then the frame that commits it to React (the map's colours are a store selector's), inside act.
  const publish: typeof fake.publish = (next) =>
    act(() => {
      fake.publish(next);
      now += 16;
      frames.frame(now);
    });
  return { ...fake, publish, renders };
}

const cube = () => readTopViewGripper()!.objects.find((object) => object.id === 'cube');

describe('the 2D map paints the round it shows (N19 E4/E5, ruling 8)', () => {
  it('round 2 of objectColors {cube: [green, red, blue]}: the cube red with red’s stripes; round 3 blue with dots; idle green with its grid', () => {
    const { publish, world } = mount();
    expect(cube()).toEqual({ id: 'cube', fill: bodyPalette.green, mark: 'grid' });
    // Round 2 (variant 1), as the session publishes it: its world's colours.
    publish({ status: 'running', world: world(0.5), objectColors: variantObjectColors(scenario, 1) });
    expect(cube()).toEqual({ id: 'cube', fill: bodyPalette.red, mark: 'stripes' });
    publish({ status: 'running', world: world(0.5), objectColors: variantObjectColors(scenario, 2) });
    expect(cube()).toEqual({ id: 'cube', fill: bodyPalette.blue, mark: 'dots' });
    // Nothing run (Đặt lại, a stop): the arena's own, round 1's.
    publish({ status: 'idle', world: null });
    expect(cube()).toEqual({ id: 'cube', fill: bodyPalette.green, mark: 'grid' });
  });

  it('draws nothing more at rest for it, and renders once a round: the same round’s publishes keep the draws and make no render', () => {
    const { publish, world, renders } = mount();
    // The run's one frozen object, as the session publishes it.
    const colors = Object.freeze(variantObjectColors(scenario, 1));
    publish({ status: 'running', world: world(0.5), objectColors: colors });
    const [draws, rendered] = [readTopViewState()!.draws, renders.length];
    publish({ status: 'running', world: world(0.6), objectColors: colors });
    publish({ status: 'running', world: world(0.7), objectColors: colors });
    expect(readTopViewState()!.draws).toBe(draws);
    expect(renders.length).toBe(rendered);
    expect(cube()!.fill).toBe(bodyPalette.red);
  });
});

describe('the zone a goal placed by colour needs, lit on the 2D map (N19 E4/E5, concern 3)', () => {
  const sort = {
    ...scenario,
    goals: [
      {
        id: 'sort',
        kind: 'object-placed',
        label: { vi: 'Phân loại', en: 'Sort' },
        points: 100,
        object: 'cube',
        zoneByColor: { [bodyPalette.green]: 'kho', [bodyPalette.red]: 'red-zone', [bodyPalette.blue]: 'blue-zone' },
        fully: true,
        maxTiltDeg: 15,
        restS: 0.5,
        carried: true,
        maxSlideCm: 3,
        minCarryLiftCm: 1,
        minCarryCm: 5,
      },
    ],
  } as unknown as Scenario;

  it('lights the zone of the cube’s colour in the round shown: the warehouse for green (nothing run), the red zone in round 2', () => {
    const { publish, world } = mount(sort);
    expect(readTopViewSensors()!.zone).toBe('kho');
    publish({ status: 'running', world: world(0.5), objectColors: variantObjectColors(sort, 1) });
    expect(readTopViewSensors()!.zone).toBe('red-zone');
    publish({ status: 'running', world: world(0.6), objectColors: variantObjectColors(sort, 2) });
    expect(readTopViewSensors()!.zone).toBe('blue-zone');
  });
});
