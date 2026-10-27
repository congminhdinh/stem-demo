// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { fullSkip } from '../../../tests/basic-skip';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { TopView2D } from './TopView2D';
import { readTopViewSensors } from './top-view-sensors-state';
import { readTopViewState } from './top-view-state';

// demo-basic (src/ui/edition.ts): the 2D map of the Basic demo has no sensor overlays, as its 3D view has none: no cone, spot, tag or lit
// goal zone (TopViewSensors' layer is not made) and no ultrasonic ray with its echo dot. The map itself is the full lab's: the mat, the
// robot where the snapshot has it with its own parts (the line sensors' dots lit where they read dark, as the 3D robot's lamps are), and
// the objects.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
const scenario = scenarioCatalog.get('rb-stop-at-wall')!;

let host: HTMLElement;
let root: Root;
beforeEach(({ skip }) => {
  fullSkip(skip, '2D map');
  installFakeCanvas2d();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount() {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  act(() =>
    root.render(
      <TextProvider locale="vi">
        <TopView2D scenario={scenario} kit={kit} model={model} store={store} zoneLabel={() => null} reason="no-webgl" />
      </TextProvider>,
    ),
  );
  return fake;
}

const sensors = (cm: number, dark: [boolean, boolean, boolean]): SensorReadout[] => [
  { role: 'ultrasonic', kind: 'ultrasonic', cm, hitId: 'wall-east' },
  { role: 'lineLeft', kind: 'line-sensor', reflectance: dark[0] ? 0 : 1, dark: dark[0], spotCm: [52.5, 51.5] },
  { role: 'lineCenter', kind: 'line-sensor', reflectance: dark[1] ? 0 : 1, dark: dark[1], spotCm: [52.5, 50] },
  { role: 'lineRight', kind: 'line-sensor', reflectance: dark[2] ? 0 : 1, dark: dark[2], spotCm: [52.5, 48.5] },
];

describe('the Basic demo’s 2D map', () => {
  it('draws no sensor overlay before a run: no overlay layer, no ray', () => {
    mount();
    expect(readTopViewSensors()).toBeNull();
    expect(readTopViewState()!.rays.map((ray) => [ray.role, ray.visible])).toEqual([['ultrasonic', false]]);
    expect(host.querySelector('[data-testid=robot-topview]')).not.toBeNull();
  });

  it('draws the robot where a run has it, its line sensors’ dots as they read, and still no ray or overlay for the echo it hears', () => {
    const { publish, world } = mount();
    publish({ status: 'running', world: world(1, 80, { robot: { ...world(1).robot, xCm: 80, yCm: 45, yawDeg: 30 }, sensors: sensors(23.5, [false, true, false]) }) });
    const state = readTopViewState()!;
    expect(state.robot).toEqual({ xCm: 80, yCm: 45, yawDeg: 30 });
    expect(state.lineDots.map((dot) => dot.dark)).toEqual([false, true, false]);
    expect(state.rays.map((ray) => ray.visible)).toEqual([false]);
    expect(readTopViewSensors()).toBeNull();
  });
});
