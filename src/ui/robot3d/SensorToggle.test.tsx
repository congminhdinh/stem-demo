// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import type { SceneProps } from './Scene';
import { SceneHost } from './SceneHost';
import { SensorToggle } from './SensorToggle';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { createRobotToolsStore } from './robot-tools-store';
import type { WebglProbe } from './quality';

// N18 R4.3: the "Hiện cảm biến" switch: on until the learner turns it off, the tools store's `sensors`, in the 3D view and over the 2D map.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The 3D scene (an R3F canvas, which jsdom cannot make) is a stand-in that keeps the props SceneHost gave it.
const scenes = vi.hoisted(() => ({ props: null as SceneProps | null }));
vi.mock('./Scene', () => ({
  default: function SceneStandIn(props: SceneProps) {
    scenes.props = props;
    return <canvas data-testid="scene-stand-in" />;
  },
}));

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-stop-at-wall')!;
const model = robotModel(kit, unoR3Board);

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  installFakeCanvas2d();
  scenes.props = null;
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

function setup() {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario, kit });
  return { store, tools };
}
const button = () => host.querySelector<HTMLButtonElement>('[data-testid=robot-sensors]');

describe('the "Hiện cảm biến" switch (N18 R4.3)', () => {
  it('is on at first, named and explained in Vietnamese, and a click turns the overlays off and on again', () => {
    const { tools } = setup();
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <SensorToggle tools={tools} variant="panel" />
        </TextProvider>,
      ),
    );
    expect(tools.getState().sensors).toBe(true);
    expect(button()?.getAttribute('aria-pressed')).toBe('true');
    expect(button()?.getAttribute('aria-label')).toBe('Hiện cảm biến');
    expect(button()?.title).toContain('Hiện cảm biến: ');
    expect(button()?.title).toContain('tia siêu âm');
    act(() => button()!.click());
    expect(tools.getState().sensors).toBe(false);
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
    act(() => button()!.click());
    expect(tools.getState().sensors).toBe(true);
    expect(button()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('follows the store when something else changes it', () => {
    const { tools } = setup();
    act(() =>
      root.render(
        <TextProvider locale="en">
          <SensorToggle tools={tools} variant="panel" />
        </TextProvider>,
      ),
    );
    expect(button()?.getAttribute('aria-label')).toBe('Show sensors');
    act(() => tools.getState().setSensors(false));
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('stands in the camera’s panel in the 3D view, and on a panel of its own over the 2D map (WebGL missing, or the learner chose it)', () => {
    const { store, tools } = setup();
    const gpu: WebglProbe = { ok: true, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)' };
    const render = (probe: () => WebglProbe) =>
      act(() =>
        root.render(
          <TextProvider locale="vi">
            <SceneHost scenario={scenario} kit={kit} model={model} store={store} reducedMotion={false} zoneLabel={() => null} tools={tools} probe={probe} />
          </TextProvider>,
        ),
      );
    render(() => gpu);
    const camera = host.querySelector('[data-testid=robot-camera]')!;
    expect(button()).not.toBeNull();
    expect(button()?.parentElement).toBe(camera);
    expect(camera.lastElementChild).toBe(button());
    expect(host.querySelectorAll('[data-testid=robot-sensors]')).toHaveLength(1);
    expect(scenes.props?.tools).toBe(tools);
    act(() => root.unmount());
    root = createRoot(host);
    render(() => ({ ok: false }));
    expect(host.querySelector('[data-testid=robot-topview]')).not.toBeNull();
    expect(button()).not.toBeNull();
    expect(button()?.closest('[data-testid=robot-camera]')).toBeNull();
    expect(host.querySelectorAll('[data-testid=robot-sensors]')).toHaveLength(1);
    act(() => button()!.click());
    expect(tools.getState().sensors).toBe(false);
  });

  it('is on a panel of its own, and only one, when the learner picks the 2D map in a view that has WebGL', () => {
    const { store, tools } = setup();
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <SceneHost scenario={scenario} kit={kit} model={model} store={store} reducedMotion={false} zoneLabel={() => null} tools={tools} probe={() => ({ ok: true, renderer: 'x' })} />
        </TextProvider>,
      ),
    );
    expect(button()?.closest('[data-testid=robot-camera]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[data-testid=robot-viewmode]')!.click());
    expect(host.querySelector('[data-testid=robot-topview]')).not.toBeNull();
    // The camera's panel is hidden with its views; the switch is the map's own, and the only one.
    expect(host.querySelector('[data-testid=robot-camera]')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelectorAll('[data-testid=robot-sensors]')).toHaveLength(1);
    expect(button()?.classList.contains('robot-sensors-panel')).toBe(true);
  });

  it('is not made without a tools store (a scene on its own draws the overlays)', () => {
    const { store } = setup();
    act(() =>
      root.render(
        <TextProvider locale="vi">
          <SceneHost scenario={scenario} kit={kit} model={model} store={store} reducedMotion={false} zoneLabel={() => null} probe={() => ({ ok: true, renderer: 'x' })} />
        </TextProvider>,
      ),
    );
    expect(button()).toBeNull();
  });
});
