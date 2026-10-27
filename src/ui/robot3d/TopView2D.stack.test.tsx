// @vitest-environment jsdom
import Konva from 'konva';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unoR3Board } from '../../core/hardware/catalog';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { translate } from '../i18n/messages';
import { TextProvider } from '../i18n/text';
import { gripperKit, gripperSnapshot, gripperTestScenario } from './__fixtures__/gripper-scene';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { TopView2D } from './TopView2D';
import { zoneLabelOf } from './zone-label';

// N19 E8 fix round 1 (review F2): the 2D map draws the moving bodies bottom-up by height, so that a cube stacked on the base (lesson 11's goal)
// is drawn over it, not under it as the arena's order had it. The order is set only when it changes (no work a publish otherwise), and a
// world whose bodies all stand on the floor (every rover lesson's) keeps the arena's order.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vi_ = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('vi', key, params);

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

function mount() {
  const fake = fakeSession(gripperTestScenario, gripperKit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  act(() =>
    root.render(
      <TextProvider locale="vi">
        <TopView2D scenario={gripperTestScenario} kit={gripperKit} model={robotModel(gripperKit, unoR3Board)} store={store} zoneLabel={(zone) => zoneLabelOf(vi_, zone)} reason="no-webgl" />
      </TextProvider>,
    ),
  );
  return fake;
}

/** The bodies' ids in the order the map draws them (its moving layer's world group, bodies first). */
const drawOrder = () => {
  const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null)!;
  return stage
    .findOne<Konva.Group>('.topview-world')!
    .getChildren()
    .filter((node) => node.hasName('topview-object'))
    .map((node) => (node as Konva.Node).getAttr('objectId') as string);
};

/** The fixture's world with the red cube at (`x`, `y`, `z`) cm (on the floor its middle is 2 cm up). */
const withRedCubeAt = (x: number, y: number, z: number): RobotSnapshot => {
  const world = gripperSnapshot({ clawDeg: 0, liftDeg: 90, heldId: null });
  return { ...world, t: 1, objects: world.objects.map((object) => (object.id === 'cube-red' ? { ...object, pose: { ...object.pose, xCm: x, yCm: y, zCm: z } } : object)) };
};

describe('the 2D map draws the bodies bottom-up (N19 E8)', () => {
  it('draws the red cube stacked on the blue base over it, and back in the arena’s order once it is on the floor again', () => {
    const { publish } = mount();
    const arenaOrder = ['cube-red', 'cube-green', 'cube-blue', 'cube-yellow', 'parcel', 'base'];
    expect(drawOrder()).toEqual(arenaOrder);
    // The base is 4 cm high: the cube on it has its bottom 4 cm up, its middle at 6.
    publish({ status: 'running', world: withRedCubeAt(104, 30, 5.96) });
    expect(drawOrder()).toEqual(['cube-green', 'cube-blue', 'cube-yellow', 'parcel', 'base', 'cube-red']);
    publish({ status: 'running', world: withRedCubeAt(52, 30, 1.99) });
    expect(drawOrder()).toEqual(arenaOrder);
  });

  it('moves the nodes only when the order changes', () => {
    const { publish } = mount();
    const moved = vi.spyOn(Konva.Node.prototype, 'setZIndex');
    publish({ status: 'running', world: withRedCubeAt(60, 30, 1.99) });
    expect(moved).not.toHaveBeenCalled();
    publish({ status: 'running', world: withRedCubeAt(104, 30, 5.96) });
    expect(moved).toHaveBeenCalled();
    moved.mockClear();
    publish({ status: 'running', world: withRedCubeAt(104.2, 30, 5.97) });
    expect(moved).not.toHaveBeenCalled();
  });
});
