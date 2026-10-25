// @vitest-environment jsdom
import Konva from 'konva';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../../core/program/block-packs';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument } from '../../samples/robot-templates';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { fakeSession } from './__fixtures__/fake-session';
import RobotLab, { type RobotLabProps } from './RobotLab';

// N18 R4.8: the view tools in the robot lab. Teleop is no run for the host (no run-started, no busy lab for a load-project); a Run after
// it is. The tools work on the 2D map too (the lab without WebGL): the ruler takes a click there. Đặt lại robot says where it goes once
// the robot was placed.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const toolbox = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);
const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
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
  delete window.__stem;
});

async function setup() {
  const template = 'rb-drive-to-zone';
  const fake = fakeSession(scenarioCatalog.get(template)!, kit);
  const onRunChange = vi.fn();
  const onBusyChange = vi.fn();
  const props: RobotLabProps = {
    template,
    program: (): ReactNode => <div data-testid="blocks" />,
    projectStore: createProjectStore(robotStarterDocument(template)),
    flushProgram: vi.fn(),
    flushEdits: vi.fn(),
    registry,
    profiles: productionProfiles,
    packs,
    toolbox,
    onRunChange,
    onBusyChange,
    createSession: () => fake.session,
    // No WebGL: the 2D map stands in for the 3D scene (R4.6).
    probe: () => ({ ok: false }),
  };
  await act(async () =>
    root.render(
      <TextProvider locale="vi">
        <RobotLab {...props} />
      </TextProvider>,
    ),
  );
  return { ...fake, onRunChange, onBusyChange };
}

const el = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const click = (testId: string) => act(async () => el(testId)!.click());

describe('the view tools in the robot lab (N18 R4.8)', () => {
  it('puts the tool strip in the robot’s view, which takes the focus for the keys', async () => {
    await setup();
    const stage = host.querySelector<HTMLElement>('.robot-stage')!;
    expect(stage.contains(el('robot-tools'))).toBe(true);
    expect(stage.tabIndex).toBe(-1);
    expect([...el('robot-tools-strip')!.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Lái tay', 'Thước đo', 'Di chuyển robot']);
    expect(stage.getAttribute('aria-label')).toBeNull();
  });

  it('teleop is no run for the host and keeps no load-project waiting once it drives; Chạy after it is a run', async () => {
    const { onRunChange, onBusyChange, session } = await setup();
    await click('robot-tool-teleop');
    expect(session.startTeleop).toHaveBeenCalledTimes(1);
    expect(el('robot-hud')!.getAttribute('data-status')).toBe('teleop');
    expect(el('robot-status')!.textContent).toBe('Đang lái tay');
    // Its time is held to TELEOP_LIMIT_S, not the lesson's 15 s; the view's name says which keys drive.
    expect(el('robot-time')!.textContent).toBe('Thời gian 0,0 / 600 s');
    const stage = host.querySelector<HTMLElement>('.robot-stage')!;
    expect([stage.getAttribute('role'), stage.getAttribute('aria-label')]).toEqual(['group', 'Khung nhìn 3D của robot: phím mũi tên hoặc W A S D để lái, phím cách để dừng']);
    expect(onRunChange).not.toHaveBeenCalled();
    // Only while its world is built (a start, as any): once it drives, a load-project need not wait.
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    await click('robot-run');
    expect(onRunChange).toHaveBeenCalledWith(true);
    expect(el('robot-tool-teleop')!.getAttribute('aria-pressed')).toBe('false');
    expect(el('robot-time')!.textContent).toBe('Thời gian 0,0 / 15 s');
    expect(host.querySelector('.robot-stage')!.getAttribute('aria-label')).toBeNull();
  });

  it('measures on the 2D map: a click there is a point of the ruler', async () => {
    await setup();
    await click('robot-tool-ruler');
    const stage = Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null)!;
    const at = stage.findOne<Konva.Group>('.topview-world')!.getAbsoluteTransform().point({ x: 100, y: 50 });
    const map = el('robot-topview')!;
    await act(async () => {
      map.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: at.x, clientY: at.y }));
      map.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: at.x, clientY: at.y }));
    });
    await click('robot-ruler-points');
    expect(el('robot-ruler-from')!.textContent).toBe('x 100,0 · y 50,0 cm');
  });

  it('once the robot is placed, Đặt lại robot can be pressed and says it goes back there, then to the lesson’s start', async () => {
    await setup();
    expect((el('robot-reset') as HTMLButtonElement).disabled).toBe(true);
    await click('robot-tool-move');
    await click('robot-move-left');
    expect((el('robot-reset') as HTMLButtonElement).disabled).toBe(false);
    expect(el('robot-reset')!.title).toBe('Đưa robot về chỗ bạn đã đặt');
    await click('robot-reset');
    expect(el('robot-reset')!.title).toBe('Bấm lần nữa để đưa robot về chỗ xuất phát của bài');
    await click('robot-reset');
    expect((el('robot-reset') as HTMLButtonElement).disabled).toBe(true);
    expect(el('robot-move-pose')!.textContent).toBe('x 25,0 · y 40,0 cm · 0°');
  });
});
