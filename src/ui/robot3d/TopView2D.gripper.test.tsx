// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { bodyPalette } from '../../core/world/arena/body-colors';
import type { RobotSnapshot, SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { translate } from '../i18n/messages';
import { TextProvider } from '../i18n/text';
import { gripperKit, gripperSnapshot, gripperTestScenario } from './__fixtures__/gripper-scene';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d, resizeObserved } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { createRobotToolsStore } from './robot-tools-store';
import { robot3dColors as robot3d } from './colors';
import { TopView2D } from './TopView2D';
import { readTopViewGripper } from './top-view-gripper-state';
import { readTopViewSensors } from './top-view-sensors-state';
import { readTopViewState } from './top-view-state';
import { zoneLabelOf } from './zone-label';
import { basicSkip } from '../../../tests/basic-skip';

// N19 E4 (Review Focus 5): the 2D map of the gripper car, in jsdom with Konva on a stand-in 2D context (the node tree is real, the pixels are
// not). It draws the boom, the carriage and the jaws from robot.gripper (the reach shortened by the cosine of the boom's elevation, the
// jaws opened by the claw), a ring round the held object, each object of a palette colour in its colour with its mark, the IR beam between
// the jaws and the colour sensor's spot with a tag that says them, the named zones' names; it draws only when that picture changes. The
// rover's map has none of it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scenario = gripperTestScenario;
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

function mount(kit: Kit = gripperKit, on = scenario) {
  const fake = fakeSession(on, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario: on, kit });
  const robot = robotModel(kit, unoR3Board);
  const render = () =>
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <TopView2D scenario={on} kit={kit} model={robot} store={store} zoneLabel={(zone) => zoneLabelOf(vi_, zone)} reason="no-webgl" tools={tools} />
        </TextProvider>,
      ),
    );
  render();
  return { ...fake, store, tools, render };
}

const gripper = () => readTopViewGripper()!;
const near = (point: { xCm: number; yCm: number }, x: number, y: number, digits = 6) => {
  expect(point.xCm).toBeCloseTo(x, digits);
  expect(point.yCm).toBeCloseTo(y, digits);
};
const DEG = Math.PI / 180;

/** The gripper car's readouts in kit order: the ultrasonic, the three line sensors, the IR between the jaws, the colour sensor. */
const readouts = (ir: { detected: boolean; hitId: string | null }, color: { hitId: string | null; distanceCm: number | null; rgbc?: { r: number; g: number; b: number; c: number } }): SensorReadout[] => [
  { role: 'ultrasonic', kind: 'ultrasonic', cm: 3.9, hitId: 'cube-red' },
  { role: 'lineLeft', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: [27, 31.5] },
  { role: 'lineCenter', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: [27, 30] },
  { role: 'lineRight', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: [27, 28.5] },
  { role: 'irClaw', kind: 'ir-obstacle', ...ir },
  { role: 'color1', kind: 'color-sensor', ...color },
];
const red = { r: 14_000, g: 3000, b: 2800, c: 19_800 };
/** The car holding the red cube, lowered, its claw closed on it (26.473°, as B2 measured), the IR seeing it and the colour read. */
const holding = (changes: Partial<RobotSnapshot> = {}): RobotSnapshot => {
  const world = gripperSnapshot({ clawDeg: 26.473, liftDeg: 0, heldId: 'cube-red' });
  return { ...world, t: 2, sensors: readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red }), ...changes };
};

describe('the gripper car on the 2D map (N19 E4)', () => {
  it('before a run: the gripper at setup()’s pose (open, raised: 5·cos 50° of reach), nothing held, no sensor drawn yet', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    mount();
    const drawn = gripper();
    expect(drawn.gripper).toMatchObject({ clawDeg: 0, liftDeg: 90, heldId: null });
    expect(drawn.gripper!.reachCm).toBeCloseTo(5 * Math.cos(50 * DEG), 9);
    expect(drawn.gripper!.jaws.map((jaw) => [jaw.side, jaw.turnDeg])).toEqual([
      [1, 12],
      [-1, -12],
    ]);
    // The robot at its start (20, 30) facing +x: the hinges 4.5 + 5·cos 50° + 0.5 cm ahead, 2.2 cm either side.
    near(drawn.gripper!.jaws[0]!.hinge, 20 + 4.5 + 5 * Math.cos(50 * DEG) + 0.5, 32.2);
    near(drawn.gripper!.jaws[1]!.hinge, 20 + 4.5 + 5 * Math.cos(50 * DEG) + 0.5, 27.8);
    expect(drawn.held).toMatchObject({ visible: false, id: null });
    expect(drawn.ir).toMatchObject({ visible: false });
    expect(drawn.color).toMatchObject({ rayVisible: false, spotVisible: false });
    expect(drawn.label).toMatchObject({ visible: false });
  });

  it('fills each object with its colour and marks the palette’s as their zones are: red stripes, green a grid, blue dots, yellow none', () => {
    mount();
    expect(gripper().objects).toEqual([
      { id: 'cube-red', fill: bodyPalette.red, mark: 'stripes' },
      { id: 'cube-green', fill: bodyPalette.green, mark: 'grid' },
      { id: 'cube-blue', fill: bodyPalette.blue, mark: 'dots' },
      { id: 'cube-yellow', fill: bodyPalette.yellow, mark: null },
      // The parcel has no colour of its own: the map's colour for an object, as the rover's lessons have it.
      { id: 'parcel', fill: robot3d.object, mark: null },
      { id: 'base', fill: bodyPalette.blue, mark: 'dots' },
    ]);
  });

  it('paints the named zones’ Vietnamese names on the mat, whatever their kind', () => {
    mount();
    expect(gripper().zoneLabels).toEqual(['Xuất phát', 'Khu lấy hàng', 'Vùng đỏ', 'Vùng xanh dương', 'Kho']);
  });

  it('holding the red cube lowered: the jaws at x 8.83 turned 0.22°, the ring round the cube, the IR strong to its 2 cm, the spot red at 1.4 cm, the tag', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    const { publish } = mount();
    const world = holding();
    publish({ status: 'running', world });
    const drawn = gripper();
    expect(drawn.gripper).toMatchObject({ clawDeg: 26.473, liftDeg: 0, heldId: 'cube-red' });
    expect(drawn.gripper!.reachCm).toBeCloseTo(5 * Math.cos(40 * DEG), 9);
    const beta = 12 - 0.445 * 26.473;
    expect(drawn.gripper!.jaws[0]!.turnDeg).toBeCloseTo(beta, 9);
    near(drawn.gripper!.jaws[0]!.hinge, 20 + 8.830222, 32.2, 5);
    near(drawn.gripper!.jaws[0]!.tip, 20 + 8.830222 + 5 * Math.cos(beta * DEG), 32.2 + 5 * Math.sin(beta * DEG), 5);
    near(drawn.gripper!.jaws[1]!.tip, 20 + 8.830222 + 5 * Math.cos(beta * DEG), 27.8 - 5 * Math.sin(beta * DEG), 5);
    // The ring round the held cube, where the world has it.
    const cube = world.objects.find((object) => object.id === 'cube-red')!;
    expect(drawn.held).toMatchObject({ visible: true, id: 'cube-red', xCm: cube.pose.xCm, yCm: cube.pose.yCm, radiusCm: 2 * Math.SQRT2 + 0.8, cased: true });
    // The IR from its mount on the carriage (u 0.3, v 0.6), 2 cm forward, strong, its end dot shown.
    const irFrom = 20 + 4.5 + 5 * Math.cos(40 * DEG) + 0.3;
    // Strong: solid, its dark casing under it along the same line and its dot ringed (fix round 1, I1: it lies on the cube it sees).
    expect(drawn.ir).toMatchObject({ visible: true, detected: true, hitId: 'cube-red', end: true, dashed: false, cased: true });
    near(drawn.ir!.from, irFrom, 30.6);
    near(drawn.ir!.to, irFrom + 2, 30.6);
    // The colour sensor's ray (u 0.3, v −0.6) to what it meets 1.4 cm on, the spot there tinted with the red its counts read.
    expect(drawn.color).toMatchObject({ rayVisible: true, spotVisible: true, color: 'red', tint: bodyPalette.red, cased: true });
    near(drawn.color!.from, irFrom, 29.4);
    near(drawn.color!.to, irFrom + 1.4, 29.4);
    expect(drawn.label).toEqual({ visible: true, lines: ['IR: có vật', 'Màu: đỏ'] });
  });

  it('says what the sensors read in words: nothing seen, the colour not read yet, a colour it cannot tell; a ray with no hit runs its range, no spot', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    const { publish } = mount();
    publish({ status: 'running', world: { ...holding(), sensors: readouts({ detected: false, hitId: null }, { hitId: null, distanceCm: null }) } });
    // Quiet: dashed, on its casing, no dot.
    expect(gripper().ir).toMatchObject({ visible: true, detected: false, end: false, dashed: true, cased: true });
    expect(gripper().color).toMatchObject({ rayVisible: true, spotVisible: false, color: null, tint: null });
    expect(gripper().color!.to.xCm - gripper().color!.from.xCm).toBeCloseTo(4, 9);
    expect(gripper().label!.lines).toEqual(['IR: không có vật', 'Màu: chưa có số đọc']);
    publish({ status: 'running', world: { ...holding(), sensors: readouts({ detected: false, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: { r: 100, g: 100, b: 50, c: 250 } }) } });
    expect(gripper().color).toMatchObject({ spotVisible: true, color: 'unknown', tint: null });
    expect(gripper().label!.lines).toEqual(['IR: không có vật', 'Màu: không rõ']);
  });

  it('draws only when its picture changes: a car at rest holding the cube draws nothing more, on either layer', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    const { publish } = mount();
    publish({ status: 'running', world: holding({ t: 2 }) });
    const [map, overlay] = [readTopViewState()!.draws, readTopViewSensors()!.draws];
    // A new time, new counts of the same red, the claw a hair off (under the 0.05° a pixel is): the same picture.
    publish({ status: 'running', world: holding({ t: 2.1 }) });
    const hair = holding({ t: 2.2 });
    publish({ status: 'running', world: { ...hair, robot: { ...hair.robot, gripper: { clawDeg: 26.49, liftDeg: 0.01, heldId: 'cube-red' } }, sensors: readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.41, rgbc: { r: 14_100, g: 3010, b: 2810, c: 19_920 } }) } });
    expect([readTopViewState()!.draws, readTopViewSensors()!.draws]).toEqual([map, overlay]);
    // The lift moving draws both; the IR going dark draws the overlay.
    const raised = holding({ t: 2.3 });
    publish({ status: 'running', world: { ...raised, robot: { ...raised.robot, gripper: { clawDeg: 26.473, liftDeg: 5, heldId: 'cube-red' } } } });
    expect([readTopViewState()!.draws, readTopViewSensors()!.draws]).toEqual([map + 1, overlay + 1]);
    expect(gripper().gripper!.reachCm).toBeCloseTo(5 * Math.cos(35 * DEG), 9);
  });

  it('draws every casing at least a pixel wide a side on a small map, and 0.15 cm a side where that is more (minor round, review 2 N1)', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    const { publish } = mount();
    publish({ status: 'running', world: holding() });
    // A small map: 300 × 200 px, the 120 × 90 cm arena at about 1.6 px a cm, where 0.15 cm is a quarter of a pixel.
    act(() => resizeObserved(300, 200));
    publish({ status: 'running', world: holding({ t: 2.5, robot: { ...holding().robot, gripper: { clawDeg: 26.473, liftDeg: 4, heldId: 'cube-red' } } }) });
    const small = readTopViewState()!.scale;
    expect(small).toBeCloseTo(146 / 90, 9);
    for (const px of [gripper().ir!.casingPx, gripper().color!.casingPx, gripper().color!.haloPx, gripper().held!.casingPx]) expect(px).toBeCloseTo(1, 9);
    // A large one: 1600 × 1000 px, about 10.5 px a cm: the casings their own 0.15 cm a side (the ring's 0.2), more than a pixel.
    act(() => resizeObserved(1600, 1000));
    publish({ status: 'running', world: holding({ t: 3, robot: { ...holding().robot, gripper: { clawDeg: 26.473, liftDeg: 8, heldId: 'cube-red' } } }) });
    const large = readTopViewState()!.scale;
    expect(large).toBeCloseTo(946 / 90, 9);
    expect(gripper().ir!.casingPx).toBeCloseTo(0.15 * large, 9);
    expect(gripper().color!.casingPx).toBeCloseTo(0.15 * large, 9);
    expect(gripper().color!.haloPx).toBeCloseTo(0.15 * large, 9);
    expect(gripper().held!.casingPx).toBeCloseTo(0.2 * large, 9);
  });

  it('keeps the jaws, the beam and the ring through a render of the map (a resize, a Run click)', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    const { publish, render } = mount();
    publish({ status: 'running', world: holding() });
    render();
    render();
    expect(gripper().gripper!.jaws[0]!.turnDeg).toBeCloseTo(12 - 0.445 * 26.473, 9);
    expect(gripper().held).toMatchObject({ visible: true, id: 'cube-red' });
    expect(gripper().ir).toMatchObject({ visible: true, detected: true });
    near(gripper().ir!.to, 20 + 4.5 + 5 * Math.cos(40 * DEG) + 2.3, 30.6);
  });

  it('“Hiện cảm biến” off takes the beam, the spot and the tag away, and leaves the jaws and the ring', ({ skip }) => {
    basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map');
    const { publish, tools } = mount();
    publish({ status: 'running', world: holding() });
    act(() => tools.getState().setSensors(false));
    expect(readTopViewSensors()!.shown).toBe(false);
    expect(gripper().held!.visible).toBe(true);
    expect(gripper().gripper!.heldId).toBe('cube-red');
    act(() => tools.getState().setSensors(true));
    expect(readTopViewSensors()!.shown).toBe(true);
    expect(gripper().label!.visible).toBe(true);
  });

  it('lets go: the ring goes, the jaws open', () => {
    const { publish } = mount();
    publish({ status: 'running', world: holding() });
    const open = gripperSnapshot({ clawDeg: 0, liftDeg: 0, heldId: null });
    publish({ status: 'running', world: { ...open, t: 3, sensors: readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red }) } });
    expect(gripper().held).toMatchObject({ visible: false, id: null });
    expect(gripper().gripper!.jaws[0]!.turnDeg).toBe(12);
  });
});

describe('the gripper car’s colour sensor on the 2D map as the run sets it up (N19 final fix, G2 I1)', () => {
  beforeEach(({ skip }) => basicSkip(skip, 'the gripper car’s lessons and its sensor overlays on the 2D map'));
  // A run whose program has no colour block never begins the sensor (robot-run-session.ts `colorSensorsOn`): lessons 8, 9 and 11 said
  // "Màu: chưa có số đọc" on every run, as the 3D view did (parts/sensor-overlay.ts reads the same field). The run in view is the one the
  // store committed (color-sensors-on.ts): the store's frames by hand (TopView2D.rounds.test.tsx's), a publish and its frame inside act.
  const mount = () => {
    let next = 1;
    const pending = new Map<number, (now: number) => void>();
    const fake = fakeSession(scenario, gripperKit);
    const store = createRobotRunStore(fake.session, {
      requestFrame: (callback) => {
        pending.set(next, callback);
        return next++;
      },
      cancelFrame: (handle) => void pending.delete(handle),
    });
    store.getState().connect();
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <TopView2D scenario={scenario} kit={gripperKit} model={robotModel(gripperKit, unoR3Board)} store={store} zoneLabel={(zone) => zoneLabelOf(vi_, zone)} reason="no-webgl" />
        </TextProvider>,
      ),
    );
    let now = 0;
    const publish: typeof fake.publish = (snapshot) =>
      act(() => {
        fake.publish(snapshot);
        now += 16;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach((callback) => callback(now));
      });
    return { publish };
  };

  it('draws no colour ray, spot or tag line for a run that does not set it up; the IR’s beam and line as before', () => {
    const { publish } = mount();
    publish({ status: 'running', world: holding(), colorSensorsOn: [] });
    expect(gripper().color).toMatchObject({ rayVisible: false, spotVisible: false });
    expect(gripper().ir).toMatchObject({ visible: true, detected: true });
    expect(gripper().label).toEqual({ visible: true, lines: ['IR: có vật'] });
  });

  it('draws them for a run that sets it up, and follows the run shown: on, off, on again', () => {
    const { publish } = mount();
    publish({ status: 'running', world: holding(), colorSensorsOn: ['color1'] });
    expect(gripper().color).toMatchObject({ rayVisible: true, spotVisible: true, color: 'red' });
    expect(gripper().label!.lines).toEqual(['IR: có vật', 'Màu: đỏ']);
    publish({ status: 'running', world: holding({ t: 2.1 }), colorSensorsOn: [] });
    expect(gripper().color).toMatchObject({ rayVisible: false, spotVisible: false });
    expect(gripper().label!.lines).toEqual(['IR: có vật']);
    publish({ status: 'running', world: holding({ t: 2.2 }), colorSensorsOn: ['color1'] });
    expect(gripper().label!.lines).toEqual(['IR: có vật', 'Màu: đỏ']);
  });

  it('draws nothing more at rest with the sensor off: the same run, a new time', () => {
    const { publish } = mount();
    const off = Object.freeze([]) as readonly string[];
    publish({ status: 'running', world: holding({ t: 2 }), colorSensorsOn: off });
    const draws = readTopViewSensors()!.draws;
    publish({ status: 'running', world: holding({ t: 2.1 }), colorSensorsOn: off });
    expect(readTopViewSensors()!.draws).toBe(draws);
  });
});

describe('the rover’s map has nothing of the gripper (N19 E4)', () => {
  it('no boom, jaws, ring, beam, spot or tag; its objects as they were', () => {
    const rover = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
    mount(rover, scenarioCatalog.get('rb-stop-at-wall')!);
    expect(readTopViewGripper()).toMatchObject({ gripper: null, held: null, ir: null, color: null, label: null, zoneLabels: ['Xuất phát', 'Đích'] });
  });
});

