// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../../core/program/block-packs';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument, type RobotTemplateKey } from '../../samples/robot-templates';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { fakeChecks } from './__fixtures__/fake-check';
import { fakeSession } from './__fixtures__/fake-session';
import RobotLab, { type RobotLabProps } from './RobotLab';

// N18 R8: the robot lab for a screen reader and a keyboard: one polite live region and one assertive one (and no other), the events said
// once and in words, the errors said at once, the focus going to the result of a check and back to Kiểm tra, Esc closing the panels.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const toolbox = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);
const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  installFakeCanvas2d();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
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

const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const text = (testId: string) => byId(testId)?.textContent ?? null;
const click = (testId: string) => act(async () => byId(testId)!.click());
const polite = () => text('robot-check-announce');
const assertive = () => text('robot-alert-announce');
/** What the message card shows, as one line. */
const card = () => [...host.querySelectorAll('[data-testid=robot-messages] li')].map((item) => item.textContent).join(' ');

function setup(template: RobotTemplateKey = 'rb-stop-at-wall', locale: 'vi' | 'en' = 'vi') {
  const scenario = scenarioCatalog.get(template)!;
  const fake = fakeSession(scenario, kit);
  const checks = fakeChecks();
  const projectStore = createProjectStore(robotStarterDocument(template));
  const program = (): ReactNode => <input data-testid="blocks-field" />;
  const props: RobotLabProps = {
    template,
    program,
    projectStore,
    flushProgram: vi.fn(),
    flushEdits: vi.fn(),
    registry,
    profiles: productionProfiles,
    packs,
    toolbox,
    createSession: () => fake.session,
    createCheck: checks.createCheck,
    onCheck: { begin: vi.fn(), result: vi.fn(), end: vi.fn() },
    probe: () => ({ ok: false }),
  };
  const render = (changes: Partial<RobotLabProps> = {}) =>
    act(() =>
      root.render(
        <TextProvider locale={locale}>
          <RobotLab {...props} {...changes} />
        </TextProvider>,
      ),
    );
  return { ...fake, checks, scenario, render, projectStore };
}

/** Every live region the lab owns: what a screen reader would speak without being asked. */
const liveRegions = () =>
  [...host.querySelectorAll<HTMLElement>('.robot-lab [aria-live], .robot-lab [role=status], .robot-lab [role=alert], .robot-lab [role=log], .robot-lab [role=timer], .robot-lab [role=marquee]')]
    // The program's own editor is Blockly's; the Serial console is a log that is told to be quiet.
    .filter((element) => element.getAttribute('aria-live') !== 'off' && element.closest('.robot-program') === null);

const crashedResult: RobotCheckResult = {
  passed: false,
  goals: [{ id: 'stop-near-wall', label: 'Xe dừng hẳn trong vùng trước tường', passed: false }],
  score: 0,
  maxScore: 100,
  simTimeMs: 6600,
  variants: [{ seed: 1, passed: false, score: 0, simTimeMs: 6600 }],
  engine: ROBOT_ENGINE,
  scenarioVersion: 1,
  programHash: 'ab',
};

describe('the live regions of the robot lab (N18 R8)', () => {
  it('has one polite region and one assertive one, always there, and no other', async () => {
    const { render } = setup();
    await render();
    const regions = liveRegions();
    expect(regions.map((element) => [element.getAttribute('aria-live'), element.getAttribute('role'), element.dataset.testid])).toEqual([
      ['polite', null, 'robot-check-announce'],
      [null, 'alert', 'robot-alert-announce'],
    ]);
    // Off-screen: a reader hears them, nobody sees them.
    for (const region of regions) expect(region.className).toContain('visually-hidden');
  });

  it('keeps it that way while a run goes on, with Serial output, the tools’ panels, a message and a result open', async () => {
    const { render, publish, world, checks, projectStore } = setup();
    await render();
    await click('robot-run');
    await act(async () => publish({ status: 'running', world: world(2, 60), console: { lines: ['0', '1', '2'], hidden: 0 } }));
    await frame();
    expect(text('console-lines')).toBe('0\n1\n2');
    await click('robot-tool-teleop');
    await click('robot-tool-ruler');
    await click('robot-tool-move');
    await act(async () => publish({ status: 'error', error: { message: 'boom', code: 'runtime' } }));
    await frame();
    expect(byId('robot-messages')).not.toBeNull();
    await click('robot-check-start');
    await act(async () => checks.last().check.settle(crashedResult));
    await frame();
    expect(byId('robot-check-results')).not.toBeNull();
    expect(projectStore.getState().document).toBeDefined();
    expect(liveRegions()).toHaveLength(2);
  });

  it('keeps the Serial console off the screen reader’s tongue (a log that prints every frame would never stop talking) but reachable', async () => {
    const { render, publish, world } = setup();
    await render();
    await click('robot-run');
    await act(async () => publish({ status: 'running', world: world(1), console: { lines: ['hello'], hidden: 0 } }));
    await frame();
    const log = byId('console')!;
    expect([log.getAttribute('role'), log.getAttribute('aria-live'), log.getAttribute('aria-label'), log.tabIndex]).toEqual(['log', 'off', 'Bảng in', 0]);
  });

  it('gives the status, the notes and the panels no live role of their own', async () => {
    const { render } = setup();
    await render();
    expect(byId('robot-status')!.getAttribute('role')).toBeNull();
    await click('robot-tool-move');
    expect(byId('robot-move-status')!.getAttribute('role')).toBeNull();
    await click('robot-tool-ruler');
    expect(byId('robot-ruler')!.querySelector('[aria-live]')).toBeNull();
  });
});

describe('what a run says (N18 R8)', () => {
  it('says that it started, was paused and resumed, and was stopped, once each', async () => {
    const { render } = setup();
    await render();
    // The only thing said so far is why the view is the 2D map (jsdom has no WebGL).
    expect(polite()).toBe('Máy này không hiển thị được 3D, đang dùng bản đồ 2D. Chương trình, nút Chạy và các mục tiêu vẫn hoạt động như cũ.');
    await click('robot-run');
    await frame();
    expect(polite()).toBe('Đã bắt đầu chạy.');
    await click('robot-pause');
    expect(polite()).toBe('Đã tạm dừng.');
    await click('robot-pause');
    expect(polite()).toBe('Tiếp tục chạy.');
    await click('robot-stop');
    expect(polite()).toBe('Đã dừng chạy.');
    await click('robot-reset');
    expect(polite()).toBe('Robot đã về chỗ xuất phát.');
  });

  it('says how a run ended, with the score of a lesson that has one, in English too', async () => {
    const { render, publish, world } = setup('rb-stop-at-wall', 'en');
    await render();
    await click('robot-run');
    await frame();
    expect(polite()).toBe('Run started.');
    await act(async () => publish({ status: 'finished', world: world(20, 120), end: { reason: 'time-limit', atS: 20 } }));
    await frame();
    expect(polite()).toBe('Run over: time is up. Score 0 of 100.');
  });

  it('says a crash, and says nothing while the clock and the score move', async () => {
    const { render, publish, world } = setup();
    await render();
    await click('robot-run');
    await frame();
    const seen = polite();
    for (let t = 1; t < 30; t++) await act(async () => publish({ status: 'running', world: world(t, 40 + t) }));
    await frame();
    expect(polite()).toBe(seen);
    await act(async () => publish({ status: 'finished', world: world(6.6, 150), end: { reason: 'contact', atS: 6.6, tag: 'wall' } }));
    await frame();
    expect(polite()).toBe('Lượt chạy kết thúc: robot đã va chạm. Điểm 0/100.');
  });

  it('says teleop on and off, and that a Run that ends it is a run', async () => {
    const { render } = setup('rb-drive-to-zone');
    await render();
    await click('robot-tool-teleop');
    expect(polite()).toBe('Đã bật lái tay. Dùng phím mũi tên hoặc W A S D để lái, phím cách để dừng.');
    await click('robot-tool-teleop');
    expect(polite()).toBe('Đã tắt lái tay.');
    await click('robot-tool-teleop');
    await click('robot-run');
    await frame();
    expect(polite()).toBe('Đã bắt đầu chạy.');
  });

  it('says a program that does not compile, and an error in the run, to the assertive region, and not to the polite one', async () => {
    const { render, willStart } = setup();
    await render();
    willStart(Promise.resolve({ ok: false, reason: 'compile', diagnostics: [{ severity: 'error', code: 'x', message: 'Missing something.' }] }));
    const before = polite();
    await click('robot-run');
    await frame();
    expect(card()).not.toBe('');
    expect(assertive()).toBe(card());
    expect(polite()).toBe(before);
    expect(byId('robot-messages')!.getAttribute('role')).toBeNull();
  });

  it('says an error in the run the same way', async () => {
    const { render, publish, world } = setup();
    await render();
    await click('robot-run');
    await act(async () => publish({ status: 'error', error: { message: 'The robot could not move.', code: 'runtime' }, world: world(1) }));
    await frame();
    expect(card()).toContain('The robot could not move');
    expect(assertive()).toBe(card());
  });

  it('says a start that did not happen only once, however often it renders', async () => {
    const { render, willStart } = setup();
    willStart(Promise.resolve({ ok: false, reason: 'compile', diagnostics: [] }));
    await render();
    await click('robot-run');
    await frame();
    const first = host.querySelector('[data-testid=robot-alert-announce] span')!;
    await render();
    await render();
    expect(host.querySelector('[data-testid=robot-alert-announce] span')).toBe(first);
  });
});

describe('what a check says (N18 R8)', () => {
  it('says the start, each round and the result in the one polite region, and no run of the check’s own', async () => {
    const { render, checks, world } = setup();
    await render();
    await click('robot-run');
    await frame();
    await click('robot-check-start');
    expect(polite()).toBe('Đang kiểm tra…');
    await act(async () => checks.last().onProgress({ kind: 'time', index: 0, tS: 3, timeLimitS: 20 }));
    // The check's own run is shown in the view (1×): it is no run of the learner's to announce.
    await act(async () => checks.last().check.publish({ status: 'running', world: world(3, 50) }));
    await frame();
    expect(polite()).toBe('Đang kiểm tra…');
    await act(async () => checks.last().check.settle(crashedResult));
    await frame();
    expect(polite()).toBe('Kết quả kiểm tra: Chưa đạt, 0/100 điểm');
  });

  it('says a check that did not finish to the assertive region, and its card is no alert of its own', async () => {
    const { render, checks } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    await click('robot-check-start');
    await act(async () => checks.last().check.fail(new Error('the lab broke')));
    await frame();
    expect(assertive()).toBe('Không kiểm tra xong vì có lỗi bên trong lab, nên bài học chưa nhận được kết quả nào. Hãy bấm Kiểm tra lại.');
    expect(byId('robot-check-failure')!.getAttribute('role')).toBeNull();
  });
});

describe('the focus after a check (N18 R8)', () => {
  it('goes to the result’s heading when the check ends, and Escape or × in the card gives it back to Kiểm tra', async () => {
    const { render, checks } = setup();
    await render();
    await click('robot-check-start');
    expect(document.activeElement === byId('robot-check-start')).toBe(false);
    await act(async () => checks.last().check.settle(crashedResult));
    await frame();
    const heading = byId('robot-check-heading')!;
    expect(heading.tagName).toBe('H3');
    expect(heading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(heading);
    // Escape in the card closes it.
    await act(async () => heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(byId('robot-check-results')).toBeNull();
    expect(document.activeElement).toBe(byId('robot-check-start'));
    // And so does its ×.
    await click('robot-check-start');
    await act(async () => checks.last().check.settle(crashedResult));
    await frame();
    expect(document.activeElement).toBe(byId('robot-check-heading'));
    await click('robot-check-close');
    expect(byId('robot-check-results')).toBeNull();
    expect(document.activeElement).toBe(byId('robot-check-start'));
  });

  it('leaves the host’s focus alone: with the page not focused, or the focus elsewhere in the page, nothing is taken', async () => {
    const { render, checks } = setup();
    await render();
    const outside = document.createElement('input');
    document.body.append(outside);
    try {
      await click('robot-check-start');
      outside.focus();
      await act(async () => checks.last().check.settle(crashedResult));
      await frame();
      expect(document.activeElement).toBe(outside);
      await click('robot-check-close');
      await click('robot-check-start');
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      document.body.focus();
      await act(async () => checks.last().check.settle(crashedResult));
      await frame();
      expect(document.activeElement).not.toBe(byId('robot-check-heading'));
    } finally {
      outside.remove();
    }
  });

  it('does not take the focus for a result that comes back with the card, only for a new check', async () => {
    const { render, checks } = setup();
    await render();
    await click('robot-check-start');
    await act(async () => checks.last().check.settle(crashedResult));
    await frame();
    byId('robot-check-fold')!.focus();
    await click('robot-check-fold');
    await click('robot-check-fold');
    expect(document.activeElement).toBe(byId('robot-check-fold'));
  });
});

describe('Escape and the 3D view’s keys (N18 R8)', () => {
  it('Escape ends teleop when no tool is on, as it clears the ruler', async () => {
    const { render } = setup('rb-drive-to-zone');
    await render();
    await click('robot-tool-teleop');
    const stage = host.querySelector<HTMLElement>('.robot-stage')!;
    await act(async () => stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(byId('robot-tool-teleop')!.getAttribute('aria-pressed')).toBe('false');
    expect(polite()).toBe('Đã tắt lái tay.');
  });

  it('closes the message card with Escape and gives the focus back to the view', async () => {
    const { render, willStart } = setup();
    willStart(Promise.resolve({ ok: false, reason: 'compile', diagnostics: [] }));
    await render();
    await click('robot-run');
    await frame();
    const close = host.querySelector<HTMLButtonElement>('.robot-messages-close')!;
    close.focus();
    await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(byId('robot-messages')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.robot-stage'));
  });

  it('lists the camera’s keys and, when the robot can be driven, teleop’s, as the description of the 3D view', async () => {
    const { render } = setup('rb-drive-to-zone', 'vi');
    await render({ probe: () => ({ ok: true, renderer: 'Google SwiftShader' }) });
    // The scene itself is the canvas jsdom cannot make; the lab still says its keys in the hint.
    const hint = byId('robot-view-hint');
    expect(hint?.textContent).toBe(
      'Phím: 1 Tự do, 2 Theo xe, 3 Nhìn từ trên; 0 hoặc Home đặt lại góc nhìn; + và − phóng to, thu nhỏ; Shift cùng các phím mũi tên để xoay. Phím: ↑ hoặc W tiến, ↓ hoặc S lùi, ← hoặc A quay trái, → hoặc D quay phải, phím cách dừng',
    );
    expect(byId('robot-scene')?.getAttribute('aria-describedby')).toBe(hint?.id);
  });
});
