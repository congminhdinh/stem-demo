// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import type { Locale } from '../i18n/messages';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { createRobotToolsStore } from './robot-tools-store';
import { TopView2D } from './TopView2D';
import { readTopViewState } from './top-view-state';
import { readTopViewSensors } from './top-view-sensors-state';
import { basicSkip } from '../../../tests/basic-skip';

// N18 R4.3: the sensor overlay on the 2D map (TopViewSensors.tsx), in jsdom with Konva on a stand-in 2D context. It draws the cone of the
// ultrasonic sensor to the distance it heard with a tag in cm (the learner's decimal comma), a ring on the mat at each line sensor's
// spot (a red disc where it reads dark), and the zone of the next unmet goal; "Hiện cảm biến" turns it all off, the map's ray with it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
// 160 × 100 cm; the robot starts at (45, 50) facing +x; the goal is the stop zone at x 126..146.
const scenario = scenarioCatalog.get('rb-stop-at-wall')!;

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

function mount(locale: Locale = 'vi') {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario, kit });
  const render = () =>
    act(() =>
      root.render(
        <TextProvider locale={locale}>
          <TopView2D scenario={scenario} kit={kit} model={model} store={store} zoneLabel={() => null} reason="no-webgl" tools={tools} />
        </TextProvider>,
      ),
    );
  render();
  return { ...fake, store, tools, render };
}

const sensors = (cm: number, hitId: string | null, dark: [boolean, boolean, boolean] = [false, false, false]): SensorReadout[] => [
  { role: 'ultrasonic', kind: 'ultrasonic', cm, hitId },
  { role: 'lineLeft', kind: 'line-sensor', reflectance: dark[0] ? 0 : 1, dark: dark[0], spotCm: [52.5, 51.5] },
  { role: 'lineCenter', kind: 'line-sensor', reflectance: dark[1] ? 0 : 1, dark: dark[1], spotCm: [52.5, 50] },
  { role: 'lineRight', kind: 'line-sensor', reflectance: dark[2] ? 0 : 1, dark: dark[2], spotCm: null },
];
const sensorState = () => readTopViewSensors()!;

describe('the sensor overlay on the 2D map (N18 R4.3)', () => {
  beforeEach(({ skip }) => basicSkip(skip, 'the sensor overlays on the 2D map'));
  it('lights the goal’s zone before a run, with no cone, tag or spot before there is a reading', () => {
    mount();
    const state = sensorState();
    expect(state.shown).toBe(true);
    expect(state.zone).toBe('stop-zone');
    expect(state.cones.map((cone) => [cone.role, cone.visible])).toEqual([['ultrasonic', false]]);
    expect(state.labels.map((label) => label.visible)).toEqual([false]);
    expect(state.spots.map((spot) => spot.visible)).toEqual([false, false, false]);
  });

  it('draws the cone from the sensor to the distance heard, 15° each side of the axis, and writes the distance with the comma', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80.5, 'front-wall') }) });
    const { cones, labels } = sensorState();
    const cone = cones[0]!;
    expect(cone.visible).toBe(true);
    // The robot is at (45, 50) facing +x; the sensor is 7.5 cm ahead; the cone's points are the sensor, then an arc of radius 80.5 cm.
    expect(cone.points.slice(0, 2)).toEqual([52.5, 50]);
    const [x, y] = [cone.points.at(-2)!, cone.points.at(-1)!];
    expect(Math.hypot(x - 52.5, y - 50)).toBeCloseTo(80.5, 9);
    expect(Math.atan2(y - 50, x - 52.5)).toBeCloseTo((-15 * Math.PI) / 180, 9);
    expect(labels[0]).toMatchObject({ role: 'ultrasonic', visible: true, text: '80,5 cm' });
  });

  it('writes the decimal point in English', () => {
    const { publish, world } = mount('en');
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80.5, 'front-wall') }) });
    expect(sensorState().labels[0]!.text).toBe('80.5 cm');
  });

  it('draws a reading without an echo as long as the map’s ray, 40 cm, and says "không thấy vật"', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(400, null) }) });
    const { cones, labels } = sensorState();
    const [x, y] = [cones[0]!.points.at(-2)!, cones[0]!.points.at(-1)!];
    expect(Math.hypot(x - 52.5, y - 50)).toBeCloseTo(40, 9);
    expect(labels[0]!.text).toBe('không thấy vật');
    // The map's ray and its dot: the ray as it has been since R4.6.
    expect(readTopViewState()!.rays[0]).toMatchObject({ visible: true, echo: false });
  });

  it('says "nothing in range" in English, and a distance again when the echo comes back', () => {
    const { publish, world } = mount('en');
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(400, null) }) });
    expect(sensorState().labels[0]!.text).toBe('nothing in range');
    publish({ status: 'running', world: world(2, 45, { sensors: sensors(66.6, 'front-wall') }) });
    expect(sensorState().labels[0]!.text).toBe('66.6 cm');
  });

  it('turns the cone with the robot: at 90° it looks along the arena’s +y', () => {
    const { publish, world } = mount();
    const start = world(1).robot;
    publish({ status: 'running', world: world(1, 45, { robot: { ...start, xCm: 45, yCm: 50, yawDeg: 90 }, sensors: sensors(30, 'wall') }) });
    const { cones } = sensorState();
    expect(cones[0]!.points.slice(0, 2).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([45, 57.5]);
    // The middle of the arc is the axis end.
    const middle = 2 + 8;
    expect([cones[0]!.points[middle]!, cones[0]!.points[middle + 1]!].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([45, 87.5]);
  });

  it('puts a ring on the mat at each spot the readout gives, a red disc where it reads dark, nothing for a sensor that is lifted', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80, 'front-wall', [false, true, false]) }) });
    const { spots } = sensorState();
    expect(spots.map((spot) => [spot.role, spot.visible, spot.dark])).toEqual([
      ['lineLeft', true, false],
      ['lineCenter', true, true],
      ['lineRight', false, false],
    ]);
    expect([spots[0]!.xCm, spots[0]!.yCm]).toEqual([52.5, 51.5]);
    const radius = (kit.modules.find((module) => module.role === 'lineLeft')!.spec as { spotRadiusCm: number }).spotRadiusCm;
    expect(spots[0]!.radiusCm).toBe(Math.max(0.7, radius));
  });

  it('lights the zone in a strong shade of its own hue, not a colour of its own, the fill soft and the outline firm', () => {
    mount();
    const { zoneLook } = sensorState();
    // stop-zone is #d9ead3, a light green: its highlight is a green (the green channel far over the red and the blue).
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(zoneLook!.fill.slice(i, i + 2), 16));
    expect(g!).toBeGreaterThan(r! * 1.4);
    expect(g!).toBeGreaterThan(b! * 1.4);
    expect(zoneLook!.edge).toBe(zoneLook!.fill);
    expect(zoneLook!.fillOpacity).toBeLessThan(zoneLook!.edgeOpacity);
  });

  it('asks for the reduced-motion query once, not at every snapshot, and holds the pulse still when it says so', () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal('matchMedia', matchMedia);
    const { publish, world } = mount();
    for (let i = 1; i <= 6; i++) publish({ status: 'running', world: world(i, 45 + i, { sensors: sensors(80 - i, 'front-wall') }) });
    expect(matchMedia).toHaveBeenCalledTimes(1);
    // Still: the middle of the pulse's range, whatever the time.
    expect(sensorState().zoneLook!.fillOpacity).toBeCloseTo(0.18 + 0.12 * 0.5, 9);
    expect(sensorState().zoneLook!.edgeOpacity).toBeCloseTo(0.6 + 0.3 * 0.5, 9);
  });

  it('lights the zone until the goal passes, then none', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80, 'front-wall') }) });
    expect(sensorState().zone).toBe('stop-zone');
    const done = { points: 70, maxScore: 100, goals: [{ id: 'stop-near-wall', passed: true, points: 70, progress: 1 }] };
    publish({ status: 'running', world: world(2, 45, { sensors: sensors(80, 'front-wall'), score: done }) });
    expect(sensorState().zone).toBeNull();
  });

  it('is off with "Hiện cảm biến", the map’s ray too, and back with the last reading when it is on again', () => {
    const { publish, world, tools } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80.5, 'front-wall') }) });
    expect(readTopViewState()!.rays[0]!.visible).toBe(true);
    act(() => tools.getState().setSensors(false));
    expect(sensorState().shown).toBe(false);
    expect(readTopViewState()!.rays[0]!.visible).toBe(false);
    act(() => tools.getState().setSensors(true));
    expect(sensorState().shown).toBe(true);
    expect(sensorState().labels[0]).toMatchObject({ visible: true, text: '80,5 cm' });
    expect(readTopViewState()!.rays[0]!.visible).toBe(true);
  });

  it('draws only when its picture changes: a robot at rest draws nothing more', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80.5, 'front-wall') }) });
    const draws = sensorState().draws;
    publish({ status: 'running', world: world(2, 45, { sensors: sensors(80.5, 'front-wall') }) });
    publish({ status: 'running', world: world(3, 45, { sensors: sensors(80.52, 'front-wall') }) });
    expect(sensorState().draws).toBe(draws);
    publish({ status: 'running', world: world(4, 45, { sensors: sensors(79.1, 'front-wall') }) });
    expect(sensorState().draws).toBe(draws + 1);
  });

  it('keeps the cone through a render of the map (a resize, a Run click)', () => {
    const { publish, world, render } = mount();
    publish({ status: 'running', world: world(1, 45, { sensors: sensors(80.5, 'front-wall') }) });
    render();
    render();
    expect(sensorState().cones[0]!.visible).toBe(true);
    expect(sensorState().cones[0]!.points.slice(0, 2)).toEqual([52.5, 50]);
    expect(sensorState().labels[0]!.text).toBe('80,5 cm');
  });
});
