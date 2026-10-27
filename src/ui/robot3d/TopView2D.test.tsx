// @vitest-environment jsdom
import Konva from 'konva';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d, resizeObserved } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { TopView2D } from './TopView2D';
import { readTopViewState } from './top-view-state';
import { basicSkip } from '../../../tests/basic-skip';

// N18 R4.6: the 2D top view, rendered in jsdom (Konva gets a stand-in 2D context: the node tree is real, the pixels are not) over a
// session the test drives. It draws the robot, the sensors' dots and rays and the moving bodies where the snapshot has them, in the
// arena's own centimetres, and draws only when the picture changes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);

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

function mount(scenario: Pick<Scenario, 'arena' | 'start'> = scenarioCatalog.get('rb-line-follow')!, reason: 'no-webgl' | 'context-lost' | 'chosen' | null = 'no-webgl') {
  const fake = fakeSession(scenarioCatalog.get('rb-line-follow')!, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const zoneLabel = (zone: { kind: string }) => (zone.kind === 'start' ? 'Xuất phát' : null);
  // Every call renders the view again from new elements with the same props, as its owner does for a Run click or a block edit.
  const render = () =>
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <TopView2D scenario={scenario} kit={kit} model={model} store={store} zoneLabel={zoneLabel} reason={reason} />
        </TextProvider>,
      ),
    );
  render();
  return { ...fake, store, render };
}

const state = () => readTopViewState()!;
const line = (dark: boolean): SensorReadout => ({ role: 'x', kind: 'line-sensor', reflectance: dark ? 0 : 1, dark, spotCm: [0, 0] });
const sensors = (ultrasonic: Extract<SensorReadout, { kind: 'ultrasonic' }>, dark: [boolean, boolean, boolean]): SensorReadout[] => [
  ultrasonic,
  { ...line(dark[0]), role: 'lineLeft' },
  { ...line(dark[1]), role: 'lineCenter' },
  { ...line(dark[2]), role: 'lineRight' },
];
const echo = (cm: number, hitId: string | null): Extract<SensorReadout, { kind: 'ultrasonic' }> => ({ role: 'ultrasonic', kind: 'ultrasonic', cm, hitId });
const near = (point: { xCm: number; yCm: number }, x: number, y: number) => {
  expect(point.xCm).toBeCloseTo(x, 6);
  expect(point.yCm).toBeCloseTo(y, 6);
};

describe('TopView2D at rest (N18 R4.6)', () => {
  it('draws the robot at the scenario’s start, scaled to fit with a 10 cm scale bar, and says why it is up', () => {
    mount();
    // 170 × 140 cm in the 600 × 400 stage with margins of 14, 14, 14 and 40: the height has 346 px, so 2.4714 px a cm.
    const view = state();
    expect(view.reason).toBe('no-webgl');
    expect(view.stage).toEqual({ width: 600, height: 400 });
    expect(view.scale).toBeCloseTo(346 / 140, 9);
    expect(view.scaleBar?.cm).toBe(10);
    expect(view.scaleBar?.lengthPx).toBeCloseTo(10 * view.scale, 9);
    expect(view.robot).toEqual({ xCm: 50, yCm: 30, yawDeg: 0 });
    expect(host.querySelector('[data-testid=robot-topview]')?.getAttribute('aria-label')).toBe('Bản đồ 2D nhìn từ trên của sa bàn và robot');
    expect(host.querySelector('[data-testid=robot-topview]')?.getAttribute('role')).toBe('img');
  });

  it('puts the line sensors’ dots at their mounts, unlit, and no ultrasonic ray before a run reads one', () => {
    mount();
    const { lineDots, rays } = state();
    expect(lineDots.map((dot) => [dot.role, dot.dark])).toEqual([
      ['lineLeft', false],
      ['lineCenter', false],
      ['lineRight', false],
    ]);
    near(lineDots[0]!, 57, 31.5);
    near(lineDots[1]!, 57, 30);
    near(lineDots[2]!, 57, 28.5);
    expect(rays.map((ray) => [ray.role, ray.visible])).toEqual([['ultrasonic', false]]);
  });

  it('draws nothing at all while its container has no size (a hidden tab), and its map once it has', () => {
    act(() => root.unmount());
    root = createRoot(host);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(0);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mount();
    expect(host.querySelector('canvas')).toBeNull();
    expect(readTopViewState()).toBeNull();
  });
});

describe('TopView2D follows the snapshots (N18 R4.6)', () => {
  it('moves the robot to the pose of each published snapshot, turned by its yaw', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 80, { robot: { ...world(1).robot, xCm: 80, yCm: 45, yawDeg: 30 } }) });
    expect(state().robot).toEqual({ xCm: 80, yCm: 45, yawDeg: 30 });
  });

  it('turns the dots and the ray with the robot: at 90° its forward is the arena’s +y', ({ skip }) => {
    basicSkip(skip, 'the ultrasonic ray on the 2D map (a sensor overlay; TopView2D.basic.test.tsx)');
    const { publish, world } = mount();
    const start = world(1).robot;
    publish({
      status: 'running',
      world: world(1, 50, { robot: { ...start, xCm: 50, yCm: 30, yawDeg: 90 }, sensors: sensors(echo(37.5, 'wall'), [false, false, false]) }),
    });
    const { lineDots, rays } = state();
    // The centre dot is 7 cm ahead, the left one is also 1.5 cm to the robot's left, which is the arena's −x.
    near(lineDots[1]!, 50, 37);
    near(lineDots[0]!, 48.5, 37);
    near(lineDots[2]!, 51.5, 37);
    near(rays[0]!.from, 50, 37.5);
    near(rays[0]!.to, 50, 75);
  });

  it('lights a line sensor’s dot while it sees the line, and only that one', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 50, { sensors: sensors(echo(400, null), [false, true, false]) }) });
    expect(state().lineDots.map((dot) => dot.dark)).toEqual([false, true, false]);
    publish({ status: 'running', world: world(2, 50, { sensors: sensors(echo(400, null), [true, true, false]) }) });
    expect(state().lineDots.map((dot) => dot.dark)).toEqual([true, true, false]);
  });

  it('draws the ultrasonic ray to its hit point with a dot there, and a short faint ray when there is no echo', ({ skip }) => {
    basicSkip(skip, 'the ultrasonic ray on the 2D map (a sensor overlay; TopView2D.basic.test.tsx)');
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 50, { sensors: sensors(echo(37.5, 'wall-east'), [false, false, false]) }) });
    const hit = state().rays[0]!;
    expect(hit).toMatchObject({ role: 'ultrasonic', visible: true, lengthCm: 37.5, echo: true, hit: true });
    near(hit.from, 57.5, 30);
    near(hit.to, 95, 30);

    publish({ status: 'running', world: world(2, 50, { sensors: sensors(echo(400, null), [false, false, false]) }) });
    const open = state().rays[0]!;
    expect(open).toMatchObject({ visible: true, lengthCm: 400, echo: false, hit: false });
    near(open.to, 57.5 + 40, 30);
  });

  it('moves the pushed bodies where the snapshot has them', () => {
    const base = scenarioCatalog.get('rb-line-follow')!;
    const scenario = {
      ...base,
      arena: {
        ...base.arena,
        cylinders: [{ centerCm: [60, 60] as [number, number], radiusCm: 3, heightCm: 6, body: 'dynamic' as const, massG: 40, tags: [], ultrasonic: true }],
        objects: [{ shape: 'box' as const, id: 'crate', centerCm: [90, 40] as [number, number], sizeCm: [6, 6, 6] as [number, number, number], yawDeg: 0, massG: 30, tags: [], ultrasonic: true }],
      },
    };
    const { publish, world } = mount(scenario);
    expect(state().objects).toEqual([
      { id: '#cylinder-0', xCm: 60, yCm: 60, yawDeg: 0 },
      { id: 'crate', xCm: 90, yCm: 40, yawDeg: 0 },
    ]);
    const pose = (xCm: number, yCm: number, yawDeg: number) => ({ xCm, yCm, zCm: 3, yawDeg, rotation: { x: 0, y: 0, z: 0, w: 1 } });
    publish({
      status: 'running',
      world: world(1, 50, {
        objects: [
          { id: '#cylinder-0', kind: 'cylinder', pose: pose(61, 62, 0) },
          { id: 'crate', kind: 'object', pose: pose(100.5, 41, 25) },
        ],
      }),
    });
    expect(state().objects).toEqual([
      { id: '#cylinder-0', xCm: 61, yCm: 62, yawDeg: 0 },
      { id: 'crate', xCm: 100.5, yCm: 41, yawDeg: 25 },
    ]);
  });

  it('shows the servo’s arm at its angle from its mount and a lit LED', () => {
    const { publish, world } = mount();
    expect(state().servos).toEqual([{ role: 'servo1', armDeg: -90 }]);
    const start = world(1).robot;
    publish({ status: 'running', world: world(1, 50, { robot: { ...start, servoDeg: { servo1: 60 } }, leds: { led1: true } }) });
    expect(state().servos).toEqual([{ role: 'servo1', armDeg: -30 }]);
    expect(state().leds).toEqual([{ role: 'led1', lit: true }]);
  });

  it('shows the start again when the run is stopped and reset, since the store then holds no world', () => {
    const { publish, world, store } = mount();
    publish({ status: 'running', world: world(1, 90) });
    expect(state().robot?.xCm).toBe(90);
    store.getState().stop();
    // A stopped run keeps its last world in view until Đặt lại.
    expect(state().robot?.xCm).toBe(90);
    void store.getState().resetRobot();
    expect(state().robot?.xCm).toBe(50);
  });
});

describe('TopView2D after React draws it again (N18 R4.6 fix round 1)', () => {
  /** The robot stopped at a wall, hearing it, with a line under its centre sensor, the servo turned and an LED lit. */
  const atTheWall = (mounted: ReturnType<typeof mount>) => {
    const start = mounted.world(1).robot;
    mounted.publish({
      status: 'running',
      world: mounted.world(1, 60, { robot: { ...start, xCm: 60, yCm: 40, yawDeg: 0, servoDeg: { servo1: 60 } }, sensors: sensors(echo(37.5, 'wall-east'), [false, true, false]), leds: { led1: true } }),
    });
  };
  /** What every moving part shows, in the arena's frame, to a millionth of a centimetre (a new scale moves the last digits of a position). */
  const shown = () => {
    const { robot, rays, lineDots, leds, servos } = state();
    return JSON.parse(JSON.stringify({ robot, rays, lineDots, leds, servos }), (_key, value: unknown) => (typeof value === 'number' ? Math.round(value * 1e6) / 1e6 + 0 : value)) as unknown;
  };

  it('keeps the ray, its hit dot and every part’s state when its owner renders it again with the same props', ({ skip }) => {
    basicSkip(skip, 'the ultrasonic ray on the 2D map (a sensor overlay; TopView2D.basic.test.tsx)');
    const mounted = mount();
    atTheWall(mounted);
    const before = shown();
    expect(state().rays[0]).toMatchObject({ visible: true, echo: true, hit: true, lengthCm: 37.5 });
    near(state().rays[0]!.to, 60 + 7.5 + 37.5, 40);
    // A Run click, a block edit, a status change: the owner renders again, over and over, while the robot rests at the wall.
    mounted.render();
    mounted.render();
    mounted.render();
    expect(shown()).toEqual(before);
    near(state().rays[0]!.to, 105, 40);
    expect(state().rays[0]).toMatchObject({ visible: true, echo: true, hit: true, lengthCm: 37.5 });
  });

  it('keeps the ray at the same arena point when the container is resized, at the new scale', ({ skip }) => {
    basicSkip(skip, 'the ultrasonic ray on the 2D map (a sensor overlay; TopView2D.basic.test.tsx)');
    const mounted = mount();
    atTheWall(mounted);
    const before = shown();
    const scale = state().scale;
    act(() => resizeObserved(800, 500));
    expect(state().stage).toEqual({ width: 800, height: 500 });
    expect(state().scale).toBeGreaterThan(scale);
    expect(shown()).toEqual(before);
    near(state().rays[0]!.to, 105, 40);
    expect(state().rays[0]).toMatchObject({ visible: true, echo: true, hit: true });
    // And back to a small one, then a render: still the same.
    act(() => resizeObserved(420, 300));
    mounted.render();
    expect(state().scale).toBeLessThan(scale);
    expect(shown()).toEqual(before);
  });

  it('still draws the next snapshot after a resize and a render', ({ skip }) => {
    basicSkip(skip, 'the ultrasonic ray on the 2D map (a sensor overlay; TopView2D.basic.test.tsx)');
    const mounted = mount();
    atTheWall(mounted);
    act(() => resizeObserved(800, 500));
    mounted.render();
    mounted.publish({ status: 'running', world: mounted.world(2, 70, { sensors: sensors(echo(27.5, 'wall-east'), [false, false, false]) }) });
    near(state().rays[0]!.to, 70 + 7.5 + 27.5, 30);
    expect(state().lineDots.map((dot) => dot.dark)).toEqual([false, false, false]);
  });
});

describe('TopView2D’s frame (N18 R4.6 fix round 1)', () => {
  /** The robot's place on the stage, px, as Konva has it. */
  const robotOnStage = () => Konva.stages.at(-1)!.findOne<Konva.Group>('.topview-robot')!.getAbsolutePosition();

  it('puts a higher yCm higher on the stage (a smaller stage y) and a larger xCm further right, at the fitted scale', () => {
    const { publish, world } = mount();
    const start = world(1).robot;
    const at = (xCm: number, yCm: number) => {
      publish({ status: 'running', world: world(1, xCm, { robot: { ...start, xCm, yCm } }) });
      return robotOnStage();
    };
    const low = at(50, 30);
    const high = at(50, 60);
    const right = at(80, 60);
    const { scale } = state();
    expect(high.y).toBeLessThan(low.y);
    expect(low.y - high.y).toBeCloseTo(30 * scale, 6);
    expect(right.x - high.x).toBeCloseTo(30 * scale, 6);
    expect(right.y).toBeCloseTo(high.y, 6);
    // 170 × 140 cm in the 600 × 400 stage, margins 14, 14, 14 and 40: the arena's lower edge (y = 0) is 346 + 14 = 360 px down.
    expect(low.y).toBeCloseTo(360 - 30 * scale, 6);
    expect(low.x).toBeCloseTo(14 + (572 - 170 * scale) / 2 + 50 * scale, 6);
  });
});

describe('TopView2D draws only when the picture changes (N18 R4.6)', () => {
  it('draws once when it is made, nothing for a snapshot that only moves the clock and the score, and once for a move', () => {
    const { publish, world } = mount();
    expect(state().draws).toBe(1);
    publish({ status: 'running', world: world(0.1, 50) });
    publish({ status: 'running', world: world(0.2, 50, { score: { points: 10, maxScore: 100, goals: [] } }) });
    publish({ status: 'running', world: world(0.3, 50.004) });
    expect(state().draws).toBe(1);
    publish({ status: 'running', world: world(0.4, 51) });
    expect(state().draws).toBe(2);
    publish({ status: 'running', world: world(0.5, 51, { sensors: sensors(echo(40, null), [false, false, false]) }) });
    expect(state().draws).toBe(3);
  });

  it('stops listening to the run when it goes', () => {
    const { publish, world } = mount();
    const errors = vi.spyOn(console, 'error');
    act(() => root.unmount());
    publish({ status: 'running', world: world(1, 90) });
    expect(readTopViewState()).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('TopView2D’s mat (N18 R4.6)', () => {
  const kinds = () => Konva.stages.at(-1)!.findOne<Konva.Group>('.topview-mat')!.getChildren().map((node) => node.getClassName());

  it('paints the mat with the 3D floor’s own paint (zones, tape, labels) on an image of the arena’s size', () => {
    mount();
    const image = Konva.stages.at(-1)!.findOne<Konva.Image>('Image')!;
    expect([image.width(), image.height()]).toEqual([170, 140]);
    // 2.4714 px a cm at the stage's size, painted at 2.5 px a cm (rounded up to a half), and the canvas is that big.
    const canvas = image.image() as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([425, 350]);
    expect(kinds().slice(0, 2)).toEqual(['Rect', 'Image']);
  });

  it('shows the scenario’s ground colour instead when there is no 2D context to paint on', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    mount();
    expect(Konva.stages.at(-1)!.find('Image')).toHaveLength(0);
    expect(kinds().slice(0, 2)).toEqual(['Rect', 'Rect']);
  });
});
