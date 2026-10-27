// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { fakeSession } from './__fixtures__/fake-session';
import { createCameraCommands, type CameraCommands } from './camera-commands';
import type { WebglProbe } from './quality';
import { robotModel } from './robot-model';
import { createRobotRunStore } from './robot-run-store';
import type { SceneProps } from './Scene';
import { SceneHost } from './SceneHost';
import { basicSkip } from '../../../tests/basic-skip';

// N18 R8: the 3D view as a keyboard and screen-reader user meets it: a stop of its own with a name and a hint, the camera's tooltips naming
// their keys, the keys' commands taking the camera's mode and reset, and the switch to the 2D map, its reason and the light graphics said
// to the announcer, none of them with a live role of their own.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scenes = vi.hoisted(() => ({ props: null as SceneProps | null, fail: false }));
vi.mock('./Scene', () => ({
  default: function SceneStandIn(props: SceneProps) {
    // A canvas that cannot get its renderer throws while it is made.
    if (scenes.fail) throw new Error('The stand-in could not make its renderer.');
    scenes.props = props;
    return <canvas data-testid="scene-stand-in" data-tier={props.tier} data-mode={props.cameraMode} data-reset={props.resetKey} />;
  },
}));

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const model = robotModel(kit, unoR3Board);
const gpu: WebglProbe = { ok: true, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)' };

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  installFakeCanvas2d();
  scenes.fail = false;
  scenes.props = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(options: { locale?: 'vi' | 'en'; probe?: () => WebglProbe; commands?: CameraCommands } = {}) {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  const announce = vi.fn();
  const alert = vi.fn();
  act(() =>
    root.render(
      <TextProvider locale={options.locale ?? 'vi'}>
        <SceneHost
          scenario={scenario}
          kit={kit}
          model={model}
          store={store}
          reducedMotion={false}
          zoneLabel={() => null}
          probe={options.probe ?? (() => gpu)}
          announce={announce}
          alert={alert}
          hint="Phím: 1 Tự do."
          hintId="view-hint"
          {...(options.commands ? { commands: options.commands } : {})}
        />
      </TextProvider>,
    ),
  );
  return { announce, alert };
}

const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const click = (testId: string) => act(() => byId(testId)!.click());

describe('the 3D view as a stop of its own (N18 R8)', () => {
  it('takes the focus, is a named application that says it takes keys, and points at the hint that lists them', ({ skip }) => {
    basicSkip(skip, 'the camera views’ keys 1 2 3 (SceneHost.basic.test.tsx has its one camera’s)');
    render();
    const view = byId('robot-scene')!;
    expect(view.tabIndex).toBe(0);
    // `application`, so that a screen reader's browse mode hands the keys to the view; on this element only (the lab around it is a page).
    expect([view.getAttribute('role'), view.getAttribute('aria-roledescription'), view.getAttribute('aria-label'), view.getAttribute('aria-describedby')]).toEqual([
      'application',
      'khung nhìn có phím tắt',
      'Khung nhìn 3D của robot',
      'view-hint',
    ]);
    expect(host.querySelectorAll('[role=application]')).toHaveLength(1);
    expect(view.hasAttribute('inert')).toBe(false);
    expect(view.hasAttribute('data-view-focus')).toBe(true);
    expect(view.getAttribute('aria-keyshortcuts')).toBe('1 2 3 0 Home + - Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown');
    const hint = byId('robot-view-hint')!;
    expect(hint.id).toBe('view-hint');
    expect(hint.textContent).toBe('Phím: 1 Tự do.');
    // The hint follows the view: it sits right after it (CSS shows it while the keyboard has the focus on the view).
    expect(view.nextElementSibling).toBe(hint);
  });

  it('names itself in English when the lab is read in English', () => {
    render({ locale: 'en' });
    expect([byId('robot-scene')!.getAttribute('aria-label'), byId('robot-scene')!.getAttribute('aria-roledescription')]).toEqual(['Robot 3D view', 'view with key shortcuts']);
  });

  // The canvas stays mounted under the map (a context that may come back; a canvas that failed): it must not stay a stop of the Tab key
  // that does nothing, with a name and a hint for keys that act on nothing.
  it.each([
    ['a canvas that failed', () => void (scenes.fail = true), () => undefined],
    [
      'a context that is gone',
      () => undefined,
      () => {
        act(() => scenes.props!.onContextLost());
        act(() => vi.advanceTimersByTime(2000));
      },
    ],
  ])('is no stop, has no name or hint, and is inert while the 2D map stands in for %s', (_name, before, lose) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      before();
      render();
      lose();
      expect(byId('robot-fallback')).not.toBeNull();
      const view = byId('robot-scene')!;
      expect(view).not.toBeNull();
      for (const attribute of ['tabindex', 'role', 'aria-label', 'aria-roledescription', 'aria-describedby', 'aria-keyshortcuts', 'data-view-focus']) {
        expect(view.hasAttribute(attribute), attribute).toBe(false);
      }
      expect(view.hasAttribute('inert')).toBe(true);
      expect(byId('robot-view-hint')).toBeNull();
      expect(host.querySelectorAll('[role=application], [data-view-focus]')).toHaveLength(0);
      // Back to 3D (the canvas works again): the stop, its name and its hint come back.
      scenes.fail = false;
      act(() => byId('robot-viewmode')!.click());
      expect(byId('robot-fallback')).toBeNull();
      const again = byId('robot-scene')!;
      expect([again.tabIndex, again.getAttribute('role'), again.hasAttribute('inert')]).toEqual([0, 'application', false]);
      expect(byId('robot-view-hint')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not there in the 2D map, which has no camera: no stop, no hint', () => {
    render({ probe: () => ({ ok: false }) });
    expect(byId('robot-scene')).toBeNull();
    expect(byId('robot-view-hint')).toBeNull();
  });

  it('gives no loading sign, lost-graphics message or note a live role: the lab’s announcer is the live region', () => {
    render();
    expect(byId('robot-3d-loading')?.getAttribute('role') ?? null).toBeNull();
    act(() => scenes.props!.onContextLost());
    expect(byId('robot-webgl-lost')?.getAttribute('role') ?? null).toBeNull();
  });
});

describe('the camera buttons name their keys (N18 R8)', () => {
  it('say each view’s key in its tooltip and as a shortcut, and the reset’s two', ({ skip }) => {
    basicSkip(skip, 'the camera-mode buttons (SceneHost.basic.test.tsx has its reset)');
    render();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-testid=robot-camera] [data-mode]')];
    expect(buttons.map((button) => [button.dataset.mode, button.title, button.getAttribute('aria-keyshortcuts')])).toEqual([
      ['orbit', 'Tự do (phím 1)', '1'],
      ['follow', 'Theo xe (phím 2)', '2'],
      ['top', 'Nhìn từ trên (phím 3)', '3'],
    ]);
    // The names stay the visible words: a tooltip is not a name.
    expect(buttons.map((button) => button.textContent)).toEqual(['Tự do', 'Theo xe', 'Nhìn từ trên']);
    const reset = byId('robot-camera-reset')!;
    expect([reset.title, reset.getAttribute('aria-label'), reset.getAttribute('aria-keyshortcuts')]).toEqual(['Đặt lại góc nhìn (phím 0 / Home)', 'Đặt lại góc nhìn', '0 Home']);
  });
});

describe('the camera’s keys in the view (N18 R8)', () => {
  it('take the view’s mode and reset it, and say so politely', ({ skip }) => {
    basicSkip(skip, 'the camera views (SceneHost.basic.test.tsx: the keys 1 2 3 do nothing, the reset works)');
    const commands = createCameraCommands();
    const { announce } = render({ commands });
    expect(byId('scene-stand-in')!.dataset.mode).toBe('orbit');
    act(() => commands.emit({ kind: 'mode', mode: 'follow' }));
    expect(byId('scene-stand-in')!.dataset.mode).toBe('follow');
    expect(byId('robot-camera')!.querySelector('[data-mode=follow]')!.getAttribute('aria-pressed')).toBe('true');
    expect(announce).toHaveBeenLastCalledWith('Góc nhìn: Theo xe.');
    const before = byId('scene-stand-in')!.dataset.reset;
    act(() => commands.emit({ kind: 'reset' }));
    expect(byId('scene-stand-in')!.dataset.reset).not.toBe(before);
    expect(announce).toHaveBeenLastCalledWith('Đã đặt lại góc nhìn.');
  });

  it('leave the zoom and the orbit to the rig, and do nothing for the 2D map', () => {
    const commands = createCameraCommands();
    const { announce } = render({ commands });
    act(() => commands.emit({ kind: 'zoom', direction: 'in' }));
    act(() => commands.emit({ kind: 'orbit', dx: 1, dy: 0 }));
    expect(announce).not.toHaveBeenCalled();
    expect(scenes.props!.commands).toBe(commands);
    click('robot-viewmode');
    act(() => commands.emit({ kind: 'mode', mode: 'top' }));
    expect(announce).toHaveBeenLastCalledWith('Đã chuyển sang bản đồ 2D.');
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe('what the view says to the announcer (N18 R8)', () => {
  it('says why it is the 2D map at the start when there is no WebGL, and no more than once', () => {
    const { announce } = render({ probe: () => ({ ok: false }) });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Máy này không hiển thị được 3D, đang dùng bản đồ 2D. Chương trình, nút Chạy và các mục tiêu vẫn hoạt động như cũ.');
    expect(byId('robot-fallback-note')?.getAttribute('role') ?? null).toBeNull();
  });

  it('says it when the learner picks the map, and when 3D is back', () => {
    const { announce } = render();
    expect(announce).not.toHaveBeenCalled();
    click('robot-viewmode');
    expect(announce).toHaveBeenLastCalledWith('Đã chuyển sang bản đồ 2D.');
    click('robot-viewmode');
    expect(announce).toHaveBeenLastCalledWith('Đã quay lại khung nhìn 3D.');
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('says the graphics are lost at once, while it waits for them, and that they are back if they come back in time', () => {
    vi.useFakeTimers();
    try {
      const { announce } = render();
      act(() => scenes.props!.onContextLost());
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith('Khung nhìn 3D bị mất đồ hoạ. Đang khôi phục…');
      act(() => vi.advanceTimersByTime(1500));
      act(() => scenes.props!.onContextRestored());
      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith('Đã quay lại khung nhìn 3D.');
      // No map came in: nothing more is said.
      act(() => vi.advanceTimersByTime(3000));
      expect(announce).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the reason the map took over from a lost context, after the wait', () => {
    vi.useFakeTimers();
    try {
      const { announce } = render();
      act(() => scenes.props!.onContextLost());
      expect(announce).toHaveBeenLastCalledWith('Khung nhìn 3D bị mất đồ hoạ. Đang khôi phục…');
      act(() => vi.advanceTimersByTime(2000));
      expect(announce).toHaveBeenLastCalledWith('Khung nhìn 3D bị mất đồ hoạ, đang dùng bản đồ 2D. Khi đồ hoạ trở lại, 3D sẽ tự quay về.');
      act(() => scenes.props!.onContextRestored());
      expect(announce).toHaveBeenLastCalledWith('Đã quay lại khung nhìn 3D.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the light graphics once, when the view lowers them itself', ({ skip }) => {
    basicSkip(skip, 'the high tier, which gives way to the low one');
    const { announce } = render();
    act(() => scenes.props!.onSlowFrames!());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Đã chuyển sang đồ hoạ nhẹ cho mượt hơn');
  });

  it('says a map that cannot be drawn to the assertive region', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A browser without a 2D canvas: the map throws while it paints its mat.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          throw new Error('no map');
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { alert } = render({ probe: () => ({ ok: false }) });
    expect(alert).toHaveBeenCalledWith('Không vẽ được bản đồ 2D. Chương trình của bạn vẫn được giữ.');
    expect(byId('robot-topview-failed')?.getAttribute('role') ?? null).toBeNull();
  });
});
