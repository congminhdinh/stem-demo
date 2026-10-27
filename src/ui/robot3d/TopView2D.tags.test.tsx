// @vitest-environment jsdom
import Konva from 'konva';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unoR3Board } from '../../core/hardware/catalog';
import type { SensorReadout } from '../../core/world/snapshot';
import type { Scenario } from '../../core/scenario/scenario';
import { translate } from '../i18n/messages';
import { TextProvider } from '../i18n/text';
import { gripperKit, gripperSnapshot, gripperTestScenario } from './__fixtures__/gripper-scene';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { createRobotToolsStore } from './robot-tools-store';
import { TopView2D } from './TopView2D';
import { readTopViewGripper, type StageRect } from './top-view-gripper-state';
import { readTopViewState } from './top-view-state';
import { GRIPPER_TAG_GAP_PX } from './top-view-tag-layout';
import { zoneLabelOf } from './zone-label';

// N19 E8 (E4/E5 review M4, the parked 2D nit): the 2D map's two-line tag of the gripper's sensors ("IR: có vật", "Màu: đỏ") stands next to
// the jaws' tips on the first side where it covers neither the car, nor the ring round what it holds, nor a distance tag, and its pointer's
// tip is GRIPPER_TAG_GAP_PX from the tips (E4 shifted it half a tag to the left, onto the car). In jsdom with Konva on a stand-in 2D context
// (a 600 × 400 stage; the stand-in measures every line 8 px wide).

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

/** The test arena with the car started at `start` (the held cube is placed from it: gripper-scene.ts). */
const at = (start: Scenario['start']): Scenario => ({ ...gripperTestScenario, start });

function mount(scenario: Scenario) {
  const fake = fakeSession(scenario, gripperKit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario, kit: gripperKit });
  act(() =>
    root.render(
      <TextProvider locale="vi">
        <TopView2D scenario={scenario} kit={gripperKit} model={robotModel(gripperKit, unoR3Board)} store={store} zoneLabel={(zone) => zoneLabelOf(vi_, zone)} reason="no-webgl" tools={tools} />
      </TextProvider>,
    ),
  );
  return fake;
}

/** The car holding the red cube lowered, the IR seeing it and the colour read; the ultrasonic hearing something `cm` off. */
function holdingAt(scenario: Scenario, cm: number) {
  const world = gripperSnapshot({ clawDeg: 26.473, liftDeg: 0, heldId: 'cube-red' }, 'running', scenario);
  const sensors: SensorReadout[] = [
    { role: 'ultrasonic', kind: 'ultrasonic', cm, hitId: 'cube-blue' },
    { role: 'lineLeft', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
    { role: 'lineCenter', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
    { role: 'lineRight', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
    { role: 'irClaw', kind: 'ir-obstacle', detected: true, hitId: 'cube-red' },
    { role: 'color1', kind: 'color-sensor', hitId: 'cube-red', distanceCm: 1.4, rgbc: { r: 14_000, g: 3000, b: 2800, c: 19_800 } },
  ];
  return { ...world, t: 2, sensors };
}

const meets = (a: StageRect, b: StageRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The jaws' tips' middle on the stage (px): the map's fit (TopView2D's margins: 14 a side, 40 under). */
function tipsOnStage() {
  const { stage, scale } = readTopViewState()!;
  const [widthCm, depthCm] = gripperTestScenario.arena.ground.sizeCm;
  const originX = 14 + (stage.width - 28 - widthCm * scale) / 2;
  const originY = 14 + (stage.height - 54 - depthCm * scale) / 2 + depthCm * scale;
  const [left, right] = readTopViewGripper()!.gripper!.jaws.map((jaw) => jaw.tip);
  return { x: originX + ((left!.xCm + right!.xCm) / 2) * scale, y: originY - ((left!.yCm + right!.yCm) / 2) * scale };
}

describe('the 2D tag of the gripper’s sensors keeps off the car and the distance tags (N19 E8)', () => {
  it('facing right: beyond the jaws, its pointer’s tip GRIPPER_TAG_GAP_PX past their tips, clear of the car and the ring', () => {
    // (Fix round 2: at y 60, where nothing is beyond the jaws; at y 45 the tag stood on the blue cube at (60, 38), which it now keeps off.)
    const scenario = at({ xCm: 40, yCm: 60, yawDeg: 0 });
    const { publish } = mount(scenario);
    publish({ status: 'running', world: holdingAt(scenario, 60) });
    const layout = readTopViewGripper()!.tagLayout!;
    expect(layout).toMatchObject({ side: 'right', clear: true });
    const tips = tipsOnStage();
    // The anchor is a finger's length straight on from the hinges; the fingers closed on the cube turn in by 0.22°: 0.0001 px short of it.
    expect(layout.tip.x).toBeCloseTo(tips.x + GRIPPER_TAG_GAP_PX, 3);
    expect(layout.tip.y).toBeCloseTo(tips.y, 3);
    expect(meets(layout.box, layout.car!)).toBe(false);
    expect(meets(layout.box, layout.ring!)).toBe(false);
    expect(layout.distances).toHaveLength(1);
    expect(meets(layout.box, layout.distances[0]!)).toBe(false);
  });

  it('facing down the screen, at every echo from 4 to 60 cm: never on the distance tag, nor the car; beside the jaws where the tag would meet it', () => {
    const scenario = at({ xCm: 60, yCm: 70, yawDeg: -90 });
    const { publish } = mount(scenario);
    const sides = new Set<string>();
    for (let cm = 4; cm <= 60; cm += 1) {
      publish({ status: 'running', world: holdingAt(scenario, cm) });
      const layout = readTopViewGripper()!.tagLayout!;
      expect(layout.clear, `${cm} cm: ${JSON.stringify(layout)}`).toBe(true);
      expect(meets(layout.box, layout.car!)).toBe(false);
      expect(meets(layout.box, layout.ring!)).toBe(false);
      for (const distance of layout.distances) expect(meets(layout.box, distance), `${cm} cm: ${JSON.stringify(layout)}`).toBe(false);
      sides.add(layout.side);
    }
    // Below the jaws (beyond them, down the screen) mostly; where the distance tag stands there, beside them.
    expect(sides.has('below')).toBe(true);
    expect([...sides].some((side) => side !== 'below')).toBe(true);
  });

  it('keeps off every other object on the map: one where the tag would stand beyond the jaws sends it beside them (fix round 2, review R1)', () => {
    const scenario = at({ xCm: 40, yCm: 60, yawDeg: 0 });
    const { publish } = mount(scenario);
    publish({ status: 'running', world: holdingAt(scenario, 60) });
    const before = readTopViewGripper()!.tagLayout!;
    expect(before.side).toBe('right');
    // The blue cube put where that tag stands (its box's middle, on the arena), as lesson 11's red cube is ahead of the jaws at its approach.
    const { stage, scale } = readTopViewState()!;
    const [widthCm, depthCm] = gripperTestScenario.arena.ground.sizeCm;
    const originX = 14 + (stage.width - 28 - widthCm * scale) / 2;
    const originY = 14 + (stage.height - 54 - depthCm * scale) / 2 + depthCm * scale;
    const [xCm, yCm] = [((before.box.left + before.box.right) / 2 - originX) / scale, (originY - (before.box.top + before.box.bottom) / 2) / scale];
    const world = holdingAt(scenario, 60);
    publish({ status: 'running', world: { ...world, t: 3, objects: world.objects.map((object) => (object.id === 'cube-blue' ? { ...object, pose: { ...object.pose, xCm, yCm } } : object)) } });
    const layout = readTopViewGripper()!.tagLayout!;
    expect(layout.side).not.toBe('right');
    expect(layout.clear).toBe(true);
    expect(layout.objects.map((object) => object.id)).toContain('cube-blue');
    for (const object of layout.objects) expect(meets(layout.box, object), `${object.id}: ${JSON.stringify(layout)}`).toBe(false);
  });

  it('facing up the screen: beyond the jaws (above them), not on the car as E4’s tag under the tips was', () => {
    const scenario = at({ xCm: 60, yCm: 30, yawDeg: 90 });
    const { publish } = mount(scenario);
    publish({ status: 'running', world: holdingAt(scenario, 60) });
    const layout = readTopViewGripper()!.tagLayout!;
    expect(layout).toMatchObject({ side: 'above', clear: true });
    expect(meets(layout.box, layout.car!)).toBe(false);
  });

  it('at the map’s right edge, facing it: another side, inside the map', () => {
    const scenario = at({ xCm: 118, yCm: 45, yawDeg: 0 });
    const { publish } = mount(scenario);
    publish({ status: 'running', world: holdingAt(scenario, 4) });
    const layout = readTopViewGripper()!.tagLayout!;
    expect(layout.side, JSON.stringify({ layout, stage: readTopViewState()!.stage })).not.toBe('right');
    expect(layout.clear).toBe(true);
    expect(layout.box.right).toBeLessThanOrEqual(readTopViewState()!.stage.width);
  });
});

describe('the zones’ names on the 2D map are under everything that moves (N19 E8)', () => {
  it('painted into the mat’s picture on the first layer; the objects, the ring round the held one and the car on the second, the tags on the third', () => {
    const scenario = at({ xCm: 40, yCm: 45, yawDeg: 0 });
    const { publish } = mount(scenario);
    publish({ status: 'running', world: holdingAt(scenario, 60) });
    const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null)!;
    const layerOf = (selector: string) => stage.getLayers().findIndex((layer) => layer.findOne(selector) !== undefined);
    // Each layer is a canvas of its own, stacked in this order: nothing on the first can be drawn over the second.
    expect(stage.getLayers().map((layer) => layer.getCanvas()._canvas.parentElement === stage.content)).toEqual([true, true, true, true]);
    expect(layerOf('.topview-mat')).toBe(0);
    expect(stage.getLayers()[0]!.find('Text').map((node) => (node as Konva.Text).text())).toEqual(['10 cm']);
    expect([layerOf('.topview-object'), layerOf('.topview-held'), layerOf('.topview-robot')]).toEqual([1, 1, 1]);
    expect([layerOf('.topview-gripper-label'), layerOf('.topview-sensor-label')]).toEqual([2, 2]);
    // The names are the mat's (painted into its picture), not nodes of their own.
    expect(readTopViewGripper()!.zoneLabels).toEqual(['Xuất phát', 'Khu lấy hàng', 'Vùng đỏ', 'Vùng xanh dương', 'Kho']);
  });
});
