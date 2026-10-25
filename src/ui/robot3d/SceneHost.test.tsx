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
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import type { WebglProbe } from './quality';
import { readTopViewState } from './top-view-state';

// N18 R4.6: when the robot lab shows its 2D top view instead of the 3D scene, and the way back. The 3D scene itself (an R3F canvas, which
// jsdom cannot make) is a stand-in here that keeps the props SceneHost gave it, so the test plays what a browser does: it takes the
// WebGL context away and gives it back.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scenes = vi.hoisted(() => ({ mounted: 0, unmounted: 0, props: null as SceneProps | null }));
vi.mock('./Scene', async () => {
  const { useEffect } = await import('react');
  return {
    default: function SceneStandIn(props: SceneProps) {
      scenes.props = props;
      useEffect(() => {
        scenes.mounted += 1;
        return () => {
          scenes.unmounted += 1;
        };
      }, []);
      return <canvas data-testid="scene-stand-in" data-tier={props.tier} />;
    },
  };
});

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const model = robotModel(kit, unoR3Board);

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  installFakeCanvas2d();
  vi.useFakeTimers();
  scenes.mounted = 0;
  scenes.unmounted = 0;
  scenes.props = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const gpu: WebglProbe = { ok: true, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)' };
const none: WebglProbe = { ok: false };

function render(probe: () => WebglProbe) {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  act(() =>
    root.render(
      <TextProvider locale="vi">
        <SceneHost scenario={scenario} kit={kit} model={model} store={store} reducedMotion={false} zoneLabel={() => null} probe={probe} />
      </TextProvider>,
    ),
  );
  return { ...fake, store };
}

const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const text = (testId: string) => byId(testId)?.textContent ?? null;
const click = (testId: string) => act(() => byId(testId)!.click());
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('SceneHost without WebGL (N18 R4.6)', () => {
  it('shows the 2D top view with the note that says why and a button to look for 3D again, and no 3D controls', () => {
    render(() => none);
    expect(byId('robot-topview')).not.toBeNull();
    expect(readTopViewState()?.reason).toBe('no-webgl');
    expect(byId('robot-scene')).toBeNull();
    expect(scenes.mounted).toBe(0);
    expect(text('robot-fallback-note')).toBe('Máy này không hiển thị được 3D, đang dùng bản đồ 2D. Chương trình, nút Chạy và các mục tiêu vẫn hoạt động như cũ.');
    expect(text('robot-viewmode')).toBe('Thử lại 3D');
    expect(byId('robot-viewmode')?.getAttribute('data-action')).toBe('retry3d');
    expect(byId('robot-camera')).toBeNull();
    expect(byId('robot-quality')).toBeNull();
  });

  it('says it in English when the lab is read in English', () => {
    const fake = fakeSession(scenario, kit);
    const store = createRobotRunStore(fake.session);
    act(() =>
      root.render(
        <TextProvider locale="en">
          <SceneHost scenario={scenario} kit={kit} model={model} store={store} reducedMotion={false} zoneLabel={() => null} probe={() => none} />
        </TextProvider>,
      ),
    );
    expect(text('robot-fallback-note')).toBe('This computer cannot show 3D, so the 2D map is used. The program, Run and the goals work the same.');
    expect(text('robot-viewmode')).toBe('Try 3D again');
  });

  it('probes again on "Thử lại 3D" and draws the 3D scene on a tier fitted to the renderer found then', () => {
    let found: WebglProbe = none;
    const probe = vi.fn(() => found);
    render(probe);
    expect(probe).toHaveBeenCalledTimes(1);
    click('robot-viewmode');
    // Still no WebGL: still the map.
    expect(probe).toHaveBeenCalledTimes(2);
    expect(byId('robot-topview')).not.toBeNull();
    found = { ok: true, renderer: 'Google SwiftShader' };
    click('robot-viewmode');
    expect(byId('robot-topview')).toBeNull();
    expect(byId('scene-stand-in')?.getAttribute('data-tier')).toBe('low');
    expect(text('robot-viewmode')).toBe('Xem 2D');
    expect(byId('robot-camera')?.hidden).toBe(false);
  });
});

describe('SceneHost with the learner’s choice (N18 R4.6)', () => {
  it('shows the 3D scene first, with "Xem 2D"', () => {
    render(() => gpu);
    expect(byId('scene-stand-in')).not.toBeNull();
    expect(byId('robot-topview')).toBeNull();
    expect(text('robot-viewmode')).toBe('Xem 2D');
    expect(byId('robot-viewmode')?.getAttribute('data-action')).toBe('show2d');
  });

  it('swaps to the map on "Xem 2D" without a note, drops the canvas, and back to a new canvas on "Xem 3D"; the run is not touched', () => {
    const { session, publish, world } = render(() => gpu);
    publish({ status: 'running', world: world(1, 70) });
    click('robot-viewmode');
    expect(readTopViewState()?.reason).toBe('chosen');
    expect(readTopViewState()?.robot?.xCm).toBe(70);
    expect(byId('robot-fallback-note')).toBeNull();
    expect(byId('scene-stand-in')).toBeNull();
    expect(scenes.unmounted).toBe(1);
    expect(text('robot-viewmode')).toBe('Xem 3D');
    expect(byId('robot-camera')?.hidden).toBe(true);
    // The map follows the run while it is up.
    publish({ status: 'running', world: world(2, 90) });
    expect(readTopViewState()?.robot?.xCm).toBe(90);

    click('robot-viewmode');
    expect(byId('robot-topview')).toBeNull();
    expect(scenes.mounted).toBe(2);
    // A new canvas has not drawn yet: the loading sign stands over it.
    expect(text('robot-3d-loading')).toBe('Đang tải 3D…');
    expect(session.start).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
    expect(session.resetRobot).not.toHaveBeenCalled();
    expect(session.getSnapshot().world?.robot.xCm).toBe(90);
  });
});

describe('SceneHost when the browser takes the WebGL context away (N18 R4.6)', () => {
  it('waits 2 s for it, then falls back to the map under the scene, and goes back to 3D when the context is restored', () => {
    render(() => gpu);
    act(() => scenes.props!.onContextLost());
    expect(text('robot-webgl-lost')).toBe('Khung nhìn 3D bị mất đồ hoạ. Đang khôi phục…');
    expect(byId('robot-topview')).toBeNull();
    advance(1999);
    expect(byId('robot-topview')).toBeNull();
    advance(1);
    expect(readTopViewState()?.reason).toBe('context-lost');
    expect(text('robot-fallback-note')).toBe('Khung nhìn 3D bị mất đồ hoạ, đang dùng bản đồ 2D. Khi đồ hoạ trở lại, 3D sẽ tự quay về.');
    expect(byId('robot-webgl-lost')).toBeNull();
    expect(text('robot-viewmode')).toBe('Thử lại 3D');
    // The scene stays mounted: it is the one that hears the context come back.
    expect(byId('scene-stand-in')).not.toBeNull();
    expect(scenes.unmounted).toBe(0);
    expect(byId('robot-camera')?.hidden).toBe(true);

    act(() => scenes.props!.onContextRestored());
    expect(byId('robot-topview')).toBeNull();
    expect(byId('robot-fallback-note')).toBeNull();
    expect(byId('robot-camera')?.hidden).toBe(false);
    expect(text('robot-viewmode')).toBe('Xem 2D');
    expect(scenes.unmounted).toBe(0);
  });

  it('keeps the scene when the context comes back within the 2 s', () => {
    render(() => gpu);
    act(() => scenes.props!.onContextLost());
    advance(1500);
    act(() => scenes.props!.onContextRestored());
    advance(5000);
    expect(byId('robot-topview')).toBeNull();
    expect(byId('robot-webgl-lost')).toBeNull();
  });

  it('makes a new canvas on "Thử lại 3D" while the map is up', () => {
    render(() => gpu);
    act(() => scenes.props!.onContextLost());
    advance(2000);
    click('robot-viewmode');
    expect(byId('robot-topview')).toBeNull();
    expect(scenes.unmounted).toBe(1);
    expect(scenes.mounted).toBe(2);
  });
});
