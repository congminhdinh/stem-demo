// @vitest-environment jsdom
import Konva from 'konva';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { createRobotToolsStore } from './robot-tools-store';
import { idleSnapshot } from './scene-math';
import { TopView2D } from './TopView2D';

// N18 R4.8: the view tools on the 2D map (R4.6's TopView2D), in jsdom with Konva on a stand-in 2D context. A pointer on the map goes to
// the arena's cm through the map's world group (its transform undone), so the ruler and the move tool work there as in the 3D view, and
// what they draw (the ruler, its label, the ghost) is on a layer of their own.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
// 170 × 140 cm with a wall along each side and a garage; the robot starts at (50, 30) facing +x.
const scenario = scenarioCatalog.get('rb-line-follow')!;

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

function mount(withTools = true) {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session, { startView: (pose) => idleSnapshot({ ...scenario, start: pose }, kit) });
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario, kit });
  // Every call renders the map again from new elements with the same props, as its owner does for a Run click or a block edit.
  const render = () =>
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <TopView2D scenario={scenario} kit={kit} model={model} store={store} zoneLabel={() => null} reason="no-webgl" {...(withTools ? { tools } : {})} />
        </TextProvider>,
      ),
    );
  render();
  return { ...fake, store, tools, render };
}

const stage = () => Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null)!;
const map = () => host.querySelector<HTMLElement>('[data-testid=robot-topview]')!;
/** The stage point (px, the container's) where the map draws the arena point: through the world group, as Konva draws it. */
const stagePoint = (xCm: number, yCm: number) => stage().findOne<Konva.Group>('.topview-world')!.getAbsoluteTransform().point({ x: xCm, y: yCm });
const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup', xCm: number, yCm: number) => {
  const { x, y } = stagePoint(xCm, yCm);
  // jsdom puts the container at (0, 0): the client point is the stage point.
  return act(async () => void map().dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7, clientX: x, clientY: y })));
};

describe('the ruler on the 2D map (N18 R4.8)', () => {
  it('takes a click as the arena point under it, and draws the segment, its points and its length upright', async () => {
    const { tools } = mount();
    tools.getState().setTool('ruler');
    await pointer('pointerdown', 100, 60);
    await pointer('pointerup', 100, 60);
    await pointer('pointerdown', 130, 100);
    await pointer('pointerup', 130, 100);
    const [a, b] = tools.getState().ruler;
    expect(a!.point.xCm).toBeCloseTo(100, 6);
    expect(a!.point.yCm).toBeCloseTo(60, 6);
    expect(b!.point.xCm).toBeCloseTo(130, 6);
    expect(b!.point.yCm).toBeCloseTo(100, 6);
    const line = stage().findOne<Konva.Line>('.topview-ruler')!;
    expect(line.points().map((value) => Math.round(value * 1e6) / 1e6)).toEqual([100, 60, 130, 100]);
    expect(stage().find('.topview-ruler-point')).toHaveLength(2);
    expect(stage().findOne<Konva.Label>('.topview-ruler-label')!.getText().text()).toBe('50,0 cm');
  });

  it('a drag is the map’s own (no point), and a click near the robot snaps to its middle', async () => {
    const { tools } = mount();
    tools.getState().setTool('ruler');
    await pointer('pointerdown', 100, 60);
    await pointer('pointerup', 120, 60);
    expect(tools.getState().ruler).toEqual([]);
    await pointer('pointerdown', 51, 31);
    await pointer('pointerup', 51, 31);
    expect(tools.getState().ruler).toEqual([{ point: { xCm: 50, yCm: 30 }, snap: 'robot' }]);
  });
});

describe('the move tool on the 2D map (N18 R4.8)', () => {
  it('drags the robot by a press on it: a ghost follows, blue, and the drop places the robot there', async () => {
    const { tools, session, store } = mount();
    tools.getState().setTool('move');
    await pointer('pointerdown', 52, 31);
    await pointer('pointermove', 102, 71);
    const ghost = stage().findOne<Konva.Line>('.topview-ghost')!;
    expect(ghost.getAttr('clear')).toBe(true);
    expect(tools.getState().ghost?.pose.xCm).toBeCloseTo(100, 6);
    expect(tools.getState().ghost?.pose.yCm).toBeCloseTo(70, 6);
    await pointer('pointerup', 102, 71);
    const placed = session.placeRobot.mock.calls[0]![0]!;
    expect(placed.xCm).toBeCloseTo(100, 6);
    expect(placed.yCm).toBeCloseTo(70, 6);
    expect(store.getState().placement?.xCm).toBeCloseTo(100, 6);
    expect(stage().findOne('.topview-ghost')).toBeUndefined();
    // The map draws the robot where it was placed.
    expect(stage().findOne<Konva.Group>('.topview-robot')!.x()).toBeCloseTo(100, 6);
  });

  it('shows the ghost red over the garage wall and places nothing there; a press beside the robot moves nothing', async () => {
    const { tools, session } = mount();
    tools.getState().setTool('move');
    await pointer('pointerdown', 120, 60);
    await pointer('pointermove', 140, 60);
    expect(tools.getState().ghost).toBeNull();
    await pointer('pointerup', 140, 60);
    await pointer('pointerdown', 50, 30);
    await pointer('pointermove', 30, 96);
    expect(stage().findOne<Konva.Line>('.topview-ghost')!.getAttr('clear')).toBe(false);
    await pointer('pointerup', 30, 96);
    expect(session.placeRobot).not.toHaveBeenCalled();
  });

  it('a render of the map in the middle of a drag keeps the drag', async () => {
    const { tools, session, render } = mount();
    tools.getState().setTool('move');
    await pointer('pointerdown', 50, 30);
    render();
    await pointer('pointermove', 90, 50);
    await pointer('pointerup', 90, 50);
    expect(session.placeRobot).toHaveBeenCalledTimes(1);
    expect(session.placeRobot.mock.calls[0]![0]!.xCm).toBeCloseTo(90, 6);
  });

  it('a map without the tools draws no tools layer and takes no pointer', async () => {
    mount(false);
    expect(stage().findOne('.topview-tools')).toBeUndefined();
  });
});
