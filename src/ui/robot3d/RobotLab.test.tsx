// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog, type Toolbox } from '../../core/program/block-packs';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument, robotTemplateKeys, type RobotTemplateKey } from '../../samples/robot-templates';
import { installTestHooks } from '../app/test-hooks';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import { goalReasons } from '../../core/scenario/goals';
import { fakeChecks } from './__fixtures__/fake-check';
import { fakeSession, idleRun } from './__fixtures__/fake-session';
import RobotLab, { type RobotLabProps, type RobotProgramView } from './RobotLab';

// The robot lab (N18 R4.1 shell, R4.2 scene, R4.4 HUD and controls), rendered in jsdom with a session the test drives. jsdom has no
// WebGL, which is itself a case the lab must handle: the 3D view says so, and the program, the run, the HUD and the console keep working.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const toolbox = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);
const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete window.__stem;
});

const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const text = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? null;
const button = (testId: string) => host.querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)!;
const click = (testId: string) => act(async () => button(testId).click());

function setup(template: RobotTemplateKey = 'rb-drive-to-zone', options: { locale?: 'en' | 'vi'; probe?: RobotLabProps['probe'] } = {}) {
  const scenario = scenarioCatalog.get(template)!;
  const fake = fakeSession(scenario, kit);
  const projectStore = createProjectStore(robotStarterDocument(template));
  const views: RobotProgramView[] = [];
  const flushProgram = vi.fn();
  const onRunChange = vi.fn();
  const program = (view: RobotProgramView): ReactNode => {
    views.push(view);
    return <div data-testid="blocks">khối lệnh</div>;
  };
  const props: RobotLabProps = {
    template,
    program,
    projectStore,
    flushProgram,
    registry,
    profiles: productionProfiles,
    packs,
    toolbox,
    onRunChange,
    createSession: () => fake.session,
    probe: options.probe ?? (() => ({ ok: false })),
  };
  const render = (changes: Partial<RobotLabProps> = {}) =>
    act(() =>
      root.render(
        <TextProvider locale={options.locale ?? 'vi'}>
          <RobotLab {...props} {...changes} />
        </TextProvider>,
      ),
    );
  return { ...fake, scenario, projectStore, views, flushProgram, onRunChange, render, lastView: () => views[views.length - 1]! };
}

/** Each category's name and the types of its blocks. */
const outline = (shown: Toolbox) => shown.contents.map((category) => [category.name, (category.contents ?? []).map((entry) => (entry as { type: string }).type)]);

describe('RobotLab (N18 R4.1, R4.2)', () => {
  it('says the lab and the scenario in Vietnamese, with a labelled 3D view, the run’s controls and the program', async () => {
    const { render } = setup();
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Robot 3D');
    expect(text('robot-scenario')).toBe('Chạy tới vùng đích');
    expect(host.querySelector('[data-testid=robot-viewport]')?.getAttribute('aria-label')).toBe('Khung nhìn robot');
    expect(host.querySelector('[data-testid=robot-lab]')?.getAttribute('data-scenario')).toBe('rb-drive-to-zone');
    expect(host.querySelector('[data-testid=program-region]')?.getAttribute('aria-label')).toBe('Chương trình');
    expect(text('blocks')).toBe('khối lệnh');
    expect([...host.querySelectorAll('[data-testid=robot-controls] > button')].map((element) => element.textContent)).toEqual(['Chạy', 'Dừng', 'Tạm dừngTiếp tục', 'Bước 0,1 s', 'Đặt lại robot']);
    expect([...host.querySelectorAll('[data-testid=robot-speed] [role=radio]')].map((element) => [element.textContent, element.getAttribute('aria-checked')])).toEqual([
      ['0,5×', 'false'],
      ['1×', 'true'],
      ['2×', 'false'],
      ['4×', 'false'],
    ]);
    expect([...host.querySelectorAll('.robot-program-tabs [role=tab]')].map((element) => element.textContent)).toEqual(['Khối lệnh', 'C++', 'Cổng & chân']);
  });

  it('says the 3D view is loading over it until its canvas draws a first frame (jsdom never draws one)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A container that never reports a size: the canvas waits to make its renderer, as a browser's does before the first frame.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const { render } = setup('rb-drive-to-zone', { probe: () => ({ ok: true, renderer: 'Test GPU' }) });
    await render();
    expect(host.querySelector('[data-testid=robot-canvas]')).not.toBeNull();
    expect(text('robot-3d-loading')).toBe('Đang tải 3D…');
    expect(host.querySelector('[data-testid=robot-scene]')?.getAttribute('data-drawn')).toBe('false');
    warn.mockRestore();
    vi.restoreAllMocks();
  });

  it('titles every scenario in its own words, and in English when the lab is read in English', async () => {
    const titles: (string | null)[] = [];
    for (const key of robotTemplateKeys) {
      await setup(key).render();
      titles.push(text('robot-scenario'));
    }
    expect(new Set(titles).size).toBe(robotTemplateKeys.length);
    await setup('rb-sandbox', { locale: 'en' }).render();
    expect(text('robot-scenario')).toBe('Free sandbox');
    expect(text('robot-run')).toBe('Run');
  });

  it('gives the block editor the scenario’s toolbox and starter, nothing to highlight and no lock', async () => {
    const { render, lastView, scenario } = setup();
    await render();
    expect(outline(lastView().toolbox)).toEqual([
      ['Program', ['stem_on_start', 'stem_forever']],
      ['Motors', ['uno_drive_move', 'uno_drive_move', 'uno_drive_stop', 'uno_motor_set', 'uno_motor_set']],
      ['Time', ['ybc_wait_ms']],
      ['Math', ['math_number']],
    ]);
    expect(lastView().emptyProgram).toBe(scenario.starter);
    expect(lastView()).toMatchObject({ highlightBlockId: null, blockWarnings: {}, readOnly: false });
  });
});

describe('RobotLab without WebGL (N18 R4.2)', () => {
  it('says the 3D view cannot be drawn, with Try again, and keeps the program and the controls', async () => {
    const probe = vi.fn(() => ({ ok: false as const }));
    const { render } = setup('rb-drive-to-zone', { probe });
    await render();
    expect(text('robot-webgl-unavailable')).toBe('Trình duyệt này không vẽ được khung nhìn 3D (WebGL bị tắt hoặc không được hỗ trợ). Chương trình của bạn vẫn được giữ.Thử lại');
    expect(text('blocks')).toBe('khối lệnh');
    expect(button('robot-run').disabled).toBe(false);
    const probes = probe.mock.calls.length;
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=robot-webgl-unavailable] button')!.click());
    expect(probe.mock.calls.length).toBe(probes + 1);
  });

  it('shows its own message with Try again when the 3D canvas cannot be made, not the chunk loader’s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A container with a size (jsdom lays nothing out), so that the canvas makes its renderer, which jsdom's WebGL-less canvas refuses.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    // As a browser without WebGL answers (jsdom's own canvas would also print that it has no 2D or WebGL).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    const { render } = setup('rb-drive-to-zone', { probe: () => ({ ok: true, renderer: 'Test GPU' }) });
    await render();
    // The canvas measures its container after a debounce of 50 ms, then makes its renderer.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(text('robot-webgl-failed')).toBe('Khung nhìn 3D gặp lỗi và đã dừng. Chương trình của bạn vẫn được giữ.Thử lại');
    // N18 R4.2 fix round 1: the loading sign gives way to the failure's message.
    expect(host.querySelector('[data-testid=robot-3d-loading]')).toBeNull();
    expect(text('blocks')).toBe('khối lệnh');
    expect(host.querySelector('[data-testid=robot-load-failed]')).toBeNull();
    warn.mockRestore();
    error.mockRestore();
    vi.restoreAllMocks();
  });
});

describe('RobotLab runs (N18 R4.4)', () => {
  it('Chạy saves the blocks and runs the project; the HUD says so and the host hears the run start and stop', async () => {
    const { render, session, flushProgram, onRunChange, projectStore } = setup();
    await render();
    expect(text('robot-status')).toBe('Chưa chạy');
    await click('robot-run');
    expect(flushProgram).toHaveBeenCalledTimes(1);
    expect(session.start).toHaveBeenCalledWith(projectStore.getState().document);
    await frame();
    expect(text('robot-status')).toBe('Đang chạy');
    expect(onRunChange.mock.calls).toEqual([[true]]);
    await click('robot-stop');
    await frame();
    expect(text('robot-status')).toBe('Đã dừng');
    expect(onRunChange.mock.calls).toEqual([[true], [false]]);
    await click('robot-reset');
    await frame();
    expect(text('robot-status')).toBe('Chưa chạy');
  });

  it('shows the time against the limit, the score and each goal as the run’s scorer says, and the slower badge', async () => {
    const { render, publish, world } = setup();
    await render();
    expect(text('robot-time')).toBe('Thời gian 0,0 / 15 s');
    expect(text('robot-score')).toBe('Điểm 0/100');
    expect([...host.querySelectorAll('[data-testid=robot-goals] li')].map((item) => [item.getAttribute('data-goal'), item.getAttribute('data-passed')])).toEqual([
      ['reach-target', 'false'],
      ['stop-in-target', 'false'],
    ]);
    expect(host.querySelector('[data-goal=reach-target] .robot-goal-label')?.textContent).toBe('Xe chạy vào vùng đích (chưa đạt)');
    await click('robot-run');
    publish({
      world: world(4.25, 80, {
        score: {
          points: 30,
          maxScore: 100,
          goals: [
            { id: 'reach-target', passed: true, points: 30, progress: 1, atS: 4.1 },
            { id: 'stop-in-target', passed: false, points: 0, progress: 0.5, reasonKey: 'robot.goal.reason.not-stopped-in-zone' },
          ],
        },
      }),
      slowerThanRealtime: true,
    });
    await frame();
    expect(text('robot-time')).toBe('Thời gian 4,2 / 15 s');
    expect(text('robot-score')).toBe('Điểm 30/100');
    expect(host.querySelector('[data-goal=reach-target]')?.getAttribute('data-passed')).toBe('true');
    expect(host.querySelector('[data-goal=stop-in-target]')?.getAttribute('title')).toBe('Robot chưa đứng yên đủ lâu trong vùng.');
    expect(host.querySelector<HTMLElement>('[data-goal=stop-in-target] .robot-goal-progress > span')?.style.width).toBe('50%');
    expect(text('robot-slower')).toBe('Chạy chậm hơn thời gian thực');
  });

  it('ends at the time limit as "Lượt chạy kết thúc", a success when every goal was met; only a crash and an error are alerts', async () => {
    const { render, publish, world } = setup();
    await render();
    await click('robot-run');
    const goals = (reach: boolean, stop: boolean) => ({
      points: (reach ? 30 : 0) + (stop ? 70 : 0),
      maxScore: 100,
      goals: [
        { id: 'reach-target', passed: reach, points: reach ? 30 : 0, progress: reach ? 1 : 0, ...(reach ? {} : { reasonKey: 'robot.goal.reason.zone-not-reached' as const }) },
        { id: 'stop-in-target', passed: stop, points: stop ? 70 : 0, progress: stop ? 1 : 0, ...(stop ? {} : { reasonKey: 'robot.goal.reason.not-stopped-in-zone' as const }) },
      ],
    });
    const badge = () => [text('robot-status'), host.querySelector('[data-testid=robot-status]')?.getAttribute('data-tone')];
    await frame();
    expect(badge()).toEqual(['Đang chạy', 'active']);
    publish({ status: 'finished', world: world(15, 90, { status: 'finished', score: goals(true, false) }), end: { reason: 'time-limit', atS: 15 } });
    await frame();
    expect(badge()).toEqual(['Lượt chạy kết thúc', 'neutral']);
    publish({ world: world(15, 90, { status: 'finished', score: goals(true, true) }) });
    await frame();
    expect(badge()).toEqual(['Lượt chạy kết thúc', 'success']);
    publish({ end: { reason: 'contact', atS: 3, tag: 'wall' } });
    await frame();
    expect(badge()).toEqual(['Hết lượt: robot đã va chạm', 'alert']);
    publish({ status: 'error', end: undefined, error: { message: 'Division by zero.', code: 'division-by-zero' } });
    await frame();
    expect(badge()).toEqual(['Lỗi', 'error']);
  });

  it('says why a run did not start, and puts the diagnostics that name a block on that block, in Vietnamese', async () => {
    const { render, willStart, lastView } = setup();
    willStart(
      Promise.resolve({
        ok: false,
        reason: 'compile',
        diagnostics: [{ severity: 'error', code: 'missing-input', message: '"if" needs a condition.', blockId: 'if-1' }],
      }),
    );
    await render();
    await click('robot-run');
    await frame();
    expect(text('robot-messages')).toContain('Chương trình có lỗi: xem các khối có dấu cảnh báo.');
    expect(lastView().blockWarnings).toEqual({ 'if-1': 'Lỗi: Khối "nếu" cần một điều kiện.' });
  });

  it('says a program’s error in Vietnamese and lights the block the robot is in', async () => {
    const { render, publish, world, lastView } = setup();
    await render();
    await click('robot-run');
    publish({ world: world(1, 30, { activeBlockId: 'go' }) });
    await frame();
    expect(lastView().highlightBlockId).toBe('go');
    publish({ status: 'error', error: { message: 'Division by zero.', code: 'division-by-zero', blockId: 'div' }, world: world(1.5, 31, { status: 'error' }) });
    await frame();
    expect(text('robot-status')).toBe('Lỗi');
    expect(text('robot-messages')).toContain('Lỗi: Chia cho 0.');
    expect(lastView().blockWarnings).toEqual({ div: 'Lỗi: Chia cho 0.' });
    expect(lastView().highlightBlockId).toBeNull();
  });

  it('Bước from idle starts the run paused and steps it; Tạm dừng and Tiếp tục hold and free the run', async () => {
    const { render, session, advances } = setup();
    await render();
    await click('robot-step');
    await frame();
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(advances.map(([ms]) => ms).slice(0, 5)).toEqual([0, 25, 25, 25, 25]);
    expect(text('robot-status')).toBe('Tạm dừng');
    expect(button('robot-pause').getAttribute('aria-pressed')).toBe('true');
    await click('robot-pause');
    await frame();
    expect(text('robot-status')).toBe('Đang chạy');
  });

  it('presses the robot’s button while it is held, by pointer or keyboard, only during a run', async () => {
    const { render, session } = setup();
    await render();
    expect(button('robot-button').disabled).toBe(true);
    await click('robot-run');
    await frame();
    expect(button('robot-button').disabled).toBe(false);
    await act(async () => button('robot-button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 })));
    await act(async () => button('robot-button').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 })));
    await act(async () => button('robot-button').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' })));
    await act(async () => button('robot-button').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', repeat: true })));
    await act(async () => button('robot-button').dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' })));
    expect(session.pressButton.mock.calls).toEqual([
      ['button1', true],
      ['button1', false],
      ['button1', true],
      ['button1', false],
    ]);
  });

  it('prints the run’s Serial in the console the other labs use, and keeps it after Stop', async () => {
    const { render, publish } = setup();
    await render();
    expect(text('robot-serial-empty')).toBe('Chưa có dòng nào được in.');
    await click('robot-run');
    publish({ console: { lines: ['xa 40 cm', 'gần 12 cm'], hidden: 0 } });
    await frame();
    expect(text('console-lines')).toBe('xa 40 cm\ngần 12 cm');
    await click('robot-stop');
    await frame();
    expect(text('console-lines')).toBe('xa 40 cm\ngần 12 cm');
  });

  it('chooses the speed with the arrows, Home and End, the chosen one the only stop of Tab in the group (a radio group)', async () => {
    const { render } = setup();
    await render();
    const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid=robot-speed] [role=radio]')];
    const state = () => radios().map((radio) => [radio.textContent, radio.getAttribute('aria-checked'), radio.tabIndex, radio === document.activeElement]);
    expect(state()).toEqual([
      ['0,5×', 'false', -1, false],
      ['1×', 'true', 0, false],
      ['2×', 'false', -1, false],
      ['4×', 'false', -1, false],
    ]);
    const key = (name: string) => act(async () => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })));
    act(() => radios()[1]!.focus());
    await key('ArrowRight');
    expect(state()[2]).toEqual(['2×', 'true', 0, true]);
    await key('End');
    expect(state()[3]).toEqual(['4×', 'true', 0, true]);
    await key('ArrowDown');
    expect(state()[0]).toEqual(['0,5×', 'true', 0, true]);
    await key('ArrowLeft');
    expect(state()[3]).toEqual(['4×', 'true', 0, true]);
    await key('Home');
    expect(state()[0]).toEqual(['0,5×', 'true', 0, true]);
    expect(state().filter(([, , tabIndex]) => tabIndex === 0)).toHaveLength(1);
  });

  it('serves window.__stem.robot: the world, its hash and the speed, which the speed buttons set too', async () => {
    installTestHooks(createProjectStore(createNewProject('p')), productionProfiles);
    const { render, publish, world } = setup();
    await render();
    const robot = window.__stem!.robot;
    expect(robot.getSnapshot()).toBeNull();
    expect(robot.snapshotHash()).toBeNull();
    await click('robot-run');
    publish({ world: world(2, 50) });
    expect((robot.getSnapshot() as { t: number }).t).toBe(2);
    expect(robot.snapshotHash()).toMatch(/^[0-9a-f]{8}$/);
    robot.setSpeed(4);
    await frame();
    expect(host.querySelector('[data-testid=robot-speed] [aria-checked=true]')?.textContent).toBe('4×');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=robot-speed] [role=radio]')!.click());
    expect(robot.getSpeed()).toBe(0.5);
  });
});

describe('RobotLab checks (N18 R6.3)', () => {
  const crashed: RobotCheckResult = {
    passed: false,
    goals: [
      { id: 'stop-near-wall', label: 'Xe dừng hẳn trong vùng trước tường', passed: false },
      { id: 'no-crash', label: 'Xe không chạm tường', passed: false },
    ],
    score: 0,
    maxScore: 100,
    simTimeMs: 20000,
    variants: [
      { seed: 1, passed: true, score: 100, simTimeMs: 20000 },
      { seed: 2, passed: false, score: 0, simTimeMs: 6600 },
      { seed: 3, passed: true, score: 100, simTimeMs: 20000 },
    ],
    engine: ROBOT_ENGINE,
    scenarioVersion: 1,
    programHash: 'ab',
  };

  function checkSetup(template: RobotTemplateKey = 'rb-stop-at-wall') {
    const lab = setup(template);
    const checks = fakeChecks();
    const onCheck = { begin: vi.fn(), result: vi.fn(), end: vi.fn() };
    const render = () => lab.render({ createCheck: checks.createCheck, onCheck });
    /** checkRobot's progress for three rounds, the second hitting the wall at 6.6 s. */
    const tellRounds = () => {
      const { onProgress } = checks.last();
      const ended = (index: number, passed: boolean) => {
        const snapshot = { ...idleRun, status: 'finished' as const, world: lab.world(passed ? 20 : 6.6, passed ? 136 : 150), end: passed ? { reason: 'time-limit' as const, atS: 20 } : { reason: 'contact' as const, atS: 6.6, tag: 'wall' } };
        onProgress({ kind: 'variant-started', index, count: 3, seed: index + 1 });
        onProgress({
          kind: 'variant-ended',
          index,
          count: 3,
          variant: crashed.variants[index]!,
          goals: passed
            ? [
                { id: 'stop-near-wall', passed: true, points: 70, progress: 1, atS: 9 },
                { id: 'no-crash', passed: true, points: 30, progress: 1, atS: 1 },
              ]
            : [
                { id: 'stop-near-wall', passed: false, points: 0, progress: 0, reasonKey: goalReasons.runEndedContact, atS: 6.6 },
                { id: 'no-crash', passed: false, points: 0, progress: 0, reasonKey: goalReasons.contact, atS: 6.6 },
              ],
          timeBonus: 0,
          end: snapshot.end,
          error: null,
          snapshot,
        });
      };
      ended(0, true);
      ended(1, false);
      ended(2, true);
    };
    return { ...lab, checks, onCheck, render, tellRounds };
  }

  const speeds = () => [...host.querySelectorAll('[data-testid=robot-check-speed] [role=radio]')].map((element) => [element.textContent, element.getAttribute('aria-checked')]);

  it('offers Kiểm tra at 1×, 4× or Nhanh for a scenario with a score, next to the run’s controls; the sandbox has nothing to check', async () => {
    const { render } = checkSetup('rb-drive-to-zone');
    await render();
    expect(text('robot-check-start')).toBe('Kiểm tra');
    expect(speeds()).toEqual([
      ['1×', 'true'],
      ['4×', 'false'],
      ['Nhanh', 'false'],
    ]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=robot-check-speed] [data-speed=fast]')!.click());
    expect(speeds()[2]).toEqual(['Nhanh', 'true']);
    // The run's controls are as they were (R4.4).
    expect([...host.querySelectorAll('[data-testid=robot-controls] > button')].map((element) => element.textContent)).toEqual(['Chạy', 'Dừng', 'Tạm dừngTiếp tục', 'Bước 0,1 s', 'Đặt lại robot']);
    // A lab is made for its scenario once (its template never changes): the sandbox is another lab.
    act(() => root.unmount());
    root = createRoot(host);
    await checkSetup('rb-sandbox').render();
    expect(host.querySelector('[data-testid=robot-check]')).toBeNull();
  });

  it('saves the blocks and tells the host it begins, holds the lab and says its round; its result says why, and goes to the host', async () => {
    const { render, checks, onCheck, flushProgram, onRunChange, lastView, tellRounds, projectStore } = checkSetup();
    await render();
    await click('robot-check-start');
    expect(flushProgram).toHaveBeenCalledTimes(1);
    expect(onCheck.begin).toHaveBeenCalledTimes(1);
    expect(flushProgram.mock.invocationCallOrder[0]).toBeLessThan(onCheck.begin.mock.invocationCallOrder[0]!);
    expect(checks.last()).toMatchObject({ project: projectStore.getState().document, mode: 'realtime', speed: 1 });
    // The lab is held: the blocks, the run's controls, the robot's button.
    expect(lastView().readOnly).toBe(true);
    for (const id of ['robot-run', 'robot-stop', 'robot-pause', 'robot-step', 'robot-reset', 'robot-button']) expect(button(id).disabled).toBe(true);
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-testid=robot-speed] [role=radio]')].every((radio) => radio.disabled)).toBe(true);
    expect(text('robot-check-round')).toBe('Lượt 1/3');
    expect(onRunChange.mock.calls).toEqual([[true]]);
    await act(async () => checks.last().onProgress({ kind: 'variant-started', index: 1, count: 3, seed: 2 }));
    expect(text('robot-check-round')).toBe('Lượt 2/3');
    expect(text('robot-round')).toBe('Lượt 2/3');
    await act(async () => {
      tellRounds();
      checks.last().check.settle(crashed);
    });
    await frame();
    expect(onCheck.result).toHaveBeenCalledWith(crashed);
    expect(onCheck.end).toHaveBeenCalledTimes(1);
    expect(onCheck.result.mock.invocationCallOrder[0]).toBeLessThan(onCheck.end.mock.invocationCallOrder[0]!);
    expect(onRunChange.mock.calls).toEqual([[true], [false]]);
    expect(text('robot-check-verdict')).toBe('Chưa đạt');
    expect(text('robot-check-score')).toBe('0/100 điểm');
    const results = host.querySelector('[data-testid=robot-check-results]')!;
    expect([...results.querySelectorAll('.robot-check-why')].map((element) => element.textContent)).toEqual([
      'Lượt chạy dừng vì xe đâm vào tường lúc 6,6 s ở lượt 2',
      'Xe chạm tường lúc 6,6 s ở lượt 2',
    ]);
    expect([...results.querySelectorAll('[data-testid=robot-check-rounds] > li')].map((element) => element.getAttribute('data-passed'))).toEqual(['true', 'false', 'true']);
    // Let go: the lab is the learner's again, and shows the round the check ended with.
    expect(lastView().readOnly).toBe(false);
    expect(button('robot-run').disabled).toBe(false);
    expect(text('robot-check-start')).toBe('Kiểm tra');
    expect(text('robot-round')).toBe('Lượt 3/3');
    expect(text('robot-status')).toBe('Lượt chạy kết thúc');
  });

  it('checks fast without showing the check’s run: its progress stands over the view, and the host hears no run', async () => {
    const { render, checks, onRunChange, world } = checkSetup();
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=robot-check-speed] [data-speed=fast]')!.click());
    await click('robot-check-start');
    expect(checks.last().mode).toBe('headless');
    await act(async () => {
      checks.last().onProgress({ kind: 'variant-started', index: 1, count: 3, seed: 2 });
      checks.last().onProgress({ kind: 'time', index: 1, tS: 10, timeLimitS: 20 });
      checks.last().check.publish({ status: 'running', world: world(10, 90) });
    });
    expect(text('robot-check-fast')).toContain('Đang kiểm tra nhanh…');
    expect(text('robot-check-fast')).toContain('Lượt 2/3');
    expect(host.querySelector('[data-testid=robot-check-fast] [role=progressbar]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(onRunChange).not.toHaveBeenCalled();
    await act(async () => checks.last().check.settle(crashed));
    await frame();
    expect(host.querySelector('[data-testid=robot-check-fast]')).toBeNull();
    expect(onRunChange).not.toHaveBeenCalled();
  });

  it('Dừng kiểm tra ends the check without a result: the host hears only that it began and ended', async () => {
    const { render, checks, onCheck } = checkSetup();
    await render();
    await click('robot-check-start');
    await click('robot-check-cancel');
    await frame();
    expect(checks.last().check.check.cancel).toHaveBeenCalledTimes(1);
    expect(onCheck.begin).toHaveBeenCalledTimes(1);
    expect(onCheck.result).not.toHaveBeenCalled();
    expect(onCheck.end).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid=robot-check-results]')).toBeNull();
    expect(button('robot-run').disabled).toBe(false);
    expect(text('robot-status')).toBe('Chưa chạy');
  });

  it('Xem lại replays the round that failed in the view at 1×; an edit of the program closes the result', async () => {
    const { render, checks, session, projectStore, tellRounds } = checkSetup();
    await render();
    await click('robot-check-start');
    const checked = projectStore.getState().document;
    await act(async () => {
      tellRounds();
      checks.last().check.settle(crashed);
    });
    expect(host.querySelector('[data-testid=robot-check-replay-1]')).toBeNull();
    await click('robot-check-replay-2');
    expect(session.start).toHaveBeenCalledWith(checked, 1, { check: true });
    expect(host.querySelector('[data-testid=robot-speed] [aria-checked=true]')?.textContent).toBe('1×');
    // Folded while it replays, so the arena shows.
    expect(host.querySelector('[data-testid=robot-check-results]')?.getAttribute('data-open')).toBe('false');
    expect(text('robot-round')).toBe('Lượt 2/3');
    await act(async () => projectStore.getState().setProgramBlocks({ blocks: { languageVersion: 0, blocks: [] } }));
    expect(host.querySelector('[data-testid=robot-check-results]')).toBeNull();
  });
});
