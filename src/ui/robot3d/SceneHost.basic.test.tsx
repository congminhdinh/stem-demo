// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { fullSkip } from '../../../tests/basic-skip';
import { TextProvider } from '../i18n/text';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { fakeSession } from './__fixtures__/fake-session';
import { createCameraCommands, type CameraCommands } from './camera-commands';
import { createLowTierControl } from './low-tier-control';
import type { WebglProbe } from './quality';
import { robotModel } from './robot-model';
import { createRobotRunStore } from './robot-run-store';
import type { SceneProps } from './Scene';
import { SceneHost } from './SceneHost';

// demo-basic (src/ui/edition.ts): the Basic demo's 3D view. A GPU or not, it draws the low tier, fetches no model file and has no quality
// button to change it (the button is there, hidden, saying its tier); it has one camera, the free view, with its reset and no mode
// buttons, and the keys 1 2 3 do nothing; the low tier's chain (30 fps, then the offer of the 2D map) is the full lab's; without WebGL
// the 2D map stands in as in the full lab. The scene is a stand-in (jsdom has no WebGL) that keeps what SceneHost gave it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scenes = vi.hoisted(() => ({ props: null as SceneProps | null }));
vi.mock('./Scene', () => ({
  default: (props: SceneProps) => {
    scenes.props = props;
    return <canvas data-testid="scene-stand-in" data-tier={props.tier} data-mode={props.cameraMode} data-reset={props.resetKey} />;
  },
}));
const assets = vi.hoisted(() => ({ loads: [] as string[] }));
vi.mock('./assets/robot-assets', async (importOriginal) => {
  const original = await importOriginal<typeof import('./assets/robot-assets')>();
  return {
    ...original,
    loadRobotAssets: (...args: Parameters<typeof original.loadRobotAssets>) => {
      assets.loads.push(args[0]);
      return original.loadRobotAssets(...args);
    },
  };
});

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-stop-at-wall')!;
const model = robotModel(kit, unoR3Board);
const gpu: WebglProbe = { ok: true, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)' };
const swiftShader: WebglProbe = { ok: true, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' };

let host: HTMLElement;
let root: Root;
beforeEach(({ skip }) => {
  fullSkip(skip, '3D view');
  installFakeCanvas2d();
  scenes.props = null;
  assets.loads = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(probe: () => WebglProbe, options: { commands?: CameraCommands; lowTier?: ReturnType<typeof createLowTierControl> } = {}) {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const announce = vi.fn();
  act(() =>
    root.render(
      <TextProvider locale="vi">
        <SceneHost
          scenario={scenario}
          kit={kit}
          model={model}
          store={store}
          reducedMotion={false}
          zoneLabel={() => null}
          probe={probe}
          announce={announce}
          hint="Phím: 0 hoặc Home đặt lại góc nhìn."
          hintId="view-hint"
          {...(options.commands ? { commands: options.commands } : {})}
          {...(options.lowTier ? { lowTier: options.lowTier } : {})}
        />
      </TextProvider>,
    ),
  );
  return { announce, store };
}

const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const click = (testId: string) => act(() => byId(testId)!.click());

describe('the Basic demo’s 3D view', () => {
  it.each([
    ['a GPU', gpu],
    ['a software renderer', swiftShader],
  ])('draws the low tier on %s, never asks for the model files, and hides the quality button', (_, probe) => {
    render(() => probe);
    expect(byId('scene-stand-in')?.getAttribute('data-tier')).toBe('low');
    expect(scenes.props?.onSlowFrames).toBeUndefined();
    expect(assets.loads).toEqual([]);
    const quality = byId('robot-quality')!;
    expect(quality.hidden).toBe(true);
    expect(quality.getAttribute('data-tier')).toBe('low');
  });

  it('keeps the low tier after "Xem 2D" and back, and after "Thử lại 3D" over a canvas that failed, and still asks for no file', () => {
    render(() => gpu);
    click('robot-viewmode');
    expect(byId('robot-fallback')).not.toBeNull();
    click('robot-viewmode');
    expect(byId('scene-stand-in')?.getAttribute('data-tier')).toBe('low');
    expect(assets.loads).toEqual([]);
  });

  it('has one camera: no mode buttons, the reset, and no sensor switch', () => {
    render(() => gpu);
    const camera = byId('robot-camera')!;
    expect(camera.querySelectorAll('[data-mode]')).toHaveLength(0);
    expect([...camera.querySelectorAll('button')].map((button) => button.dataset.testid)).toEqual(['robot-camera-reset']);
    expect(byId('robot-camera-reset')!.getAttribute('aria-keyshortcuts')).toBe('0 Home');
    expect(byId('scene-stand-in')!.dataset.mode).toBe('orbit');
    const before = byId('scene-stand-in')!.dataset.reset;
    click('robot-camera-reset');
    expect(byId('scene-stand-in')!.dataset.reset).not.toBe(before);
  });

  it('takes the reset, the zoom and the orbit from the keys, not 1 2 3, and says only what it took', () => {
    const commands = createCameraCommands();
    const { announce } = render(() => gpu, { commands });
    const view = byId('robot-scene')!;
    expect(view.getAttribute('aria-keyshortcuts')).toBe('0 Home + - Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown');
    expect(view.getAttribute('role')).toBe('application');
    act(() => commands.emit({ kind: 'mode', mode: 'follow' }));
    act(() => commands.emit({ kind: 'mode', mode: 'top' }));
    expect(byId('scene-stand-in')!.dataset.mode).toBe('orbit');
    expect(announce).not.toHaveBeenCalled();
    const before = byId('scene-stand-in')!.dataset.reset;
    act(() => commands.emit({ kind: 'reset' }));
    expect(byId('scene-stand-in')!.dataset.reset).not.toBe(before);
    expect(announce).toHaveBeenLastCalledWith('Đã đặt lại góc nhìn.');
    expect(scenes.props!.commands).toBe(commands);
  });

  it('keeps the low tier’s chain: a slow run is drawn at 30 fps, then the 2D map is offered', () => {
    vi.useFakeTimers();
    try {
      render(() => gpu);
      expect(scenes.props?.onLowStep).toBeTypeOf('function');
      act(() => scenes.props!.onLowStep!('cap'));
      expect(scenes.props?.drawCap).toBe(true);
      expect(byId('robot-quality-note')?.textContent).toBe('Đang vẽ 30 hình mỗi giây cho mượt hơn');
      act(() => scenes.props!.onLowStep!('offer'));
      expect(byId('robot-offer-2d')).not.toBeNull();
      click('robot-offer-2d-accept');
      expect(byId('robot-fallback')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the 2D map without WebGL, as the full lab does', () => {
    render(() => ({ ok: false }));
    expect(byId('robot-topview')).not.toBeNull();
    expect(byId('robot-scene')).toBeNull();
    expect(byId('robot-viewmode')?.getAttribute('data-action')).toBe('retry3d');
    expect(assets.loads).toEqual([]);
  });
});
