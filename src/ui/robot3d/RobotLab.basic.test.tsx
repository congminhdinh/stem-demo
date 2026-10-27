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
import { fullSkip } from '../../../tests/basic-skip';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import { fakeChecks } from './__fixtures__/fake-check';
import { fakeSession } from './__fixtures__/fake-session';
import RobotLab, { type RobotLabProps } from './RobotLab';

// demo-basic (src/ui/edition.ts): the robot lab of the Basic demo. Its header says the edition beside the lab's name ("Bản demo cơ bản")
// and so does the page title; the view has none of the full lab's tools (Lái tay, Thước đo, Di chuyển robot) and no sensor switch, and its
// keys are its one camera's; the program has the blocks' tab only. The run's controls, Kiểm tra and what the host hears are the full lab's:
// the same stores (RobotLab.test.tsx and robot-check-store.test.ts test them in either edition).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom cannot make the 3D canvas: where a test wants the 3D view (probe ok), a stand-in stands for the scene.
vi.mock('./Scene', () => ({ default: () => <canvas data-testid="scene-stand-in" /> }));

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const toolbox = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);
const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;

let host: HTMLElement;
let root: Root;
beforeEach(({ skip }) => {
  fullSkip(skip, 'robot lab');
  installFakeCanvas2d();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.title = 'STEM Studio';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__stem;
});

const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const text = (testId: string) => byId(testId)?.textContent ?? null;
const click = (testId: string) => act(async () => byId(testId)!.click());

function setup(template: RobotTemplateKey = 'rb-stop-at-wall', locale: 'vi' | 'en' = 'vi') {
  const scenario = scenarioCatalog.get(template)!;
  const fake = fakeSession(scenario, kit);
  const checks = fakeChecks();
  const projectStore = createProjectStore(robotStarterDocument(template));
  const onCheck = { begin: vi.fn(), result: vi.fn(), end: vi.fn() };
  const program = (): ReactNode => <div data-testid="blocks">khối lệnh</div>;
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
    onCheck,
    checkSpeeds: { read: () => '1x', write: () => {} },
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
  return { ...fake, checks, onCheck, render };
}

const result: RobotCheckResult = {
  passed: true,
  goals: [{ id: 'stop-near-wall', label: 'Xe dừng hẳn trong vùng trước tường', passed: true }],
  score: 100,
  maxScore: 100,
  simTimeMs: 4200,
  variants: [{ seed: 1, passed: true, score: 100, simTimeMs: 4200 }],
  engine: ROBOT_ENGINE,
  scenarioVersion: 1,
  programHash: 'ab',
};

describe('the Basic demo’s robot lab', () => {
  it('says the edition beside the lab’s name, over the scenario’s, in Vietnamese and in English', async () => {
    const { render } = setup();
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Robot 3D');
    expect(text('robot-edition-badge')).toBe('Bản demo cơ bản');
    expect(host.querySelector('.robot-title')?.className).toBe('robot-title robot-title-basic');
    expect([...host.querySelector('.robot-title')!.children].map((child) => child.getAttribute('data-testid') ?? child.tagName)).toEqual(['H1', 'robot-edition-badge', 'robot-scenario']);
    expect(text('robot-scenario')).toBe('Dừng trước tường');
    act(() => root.unmount());
    root = createRoot(host);
    await setup('rb-line-follow', 'en').render();
    expect(text('robot-edition-badge')).toBe('Basic demo');
  });

  it('puts the edition in the page title while it is open, and gives the title back when it goes', async () => {
    const { render } = setup();
    await render();
    expect(document.title).toBe('STEM Studio · Bản demo cơ bản');
    act(() => root.unmount());
    expect(document.title).toBe('STEM Studio');
    root = createRoot(host);
    await setup('rb-sandbox', 'en').render();
    expect(document.title).toBe('STEM Studio · Basic demo');
  });

  it('has the run’s controls and Kiểm tra as the full lab, the blocks’ tab only, and none of the view’s tools', async () => {
    const { render } = setup();
    await render();
    expect([...host.querySelectorAll('[data-testid=robot-controls] > button')].map((element) => element.textContent)).toEqual(['Chạy', 'Dừng', 'Tạm dừngTiếp tục', 'Bước 0,1 s', 'Đặt lại robot']);
    expect(byId('robot-check-start')).not.toBeNull();
    expect([...host.querySelectorAll('.robot-program-tabs [role=tab]')].map((element) => element.textContent)).toEqual(['Khối lệnh']);
    expect(host.querySelectorAll('.robot-program [role=tabpanel]')).toHaveLength(1);
    expect(text('blocks')).toBe('khối lệnh');
    expect(host.querySelector('.cpp-source')).toBeNull();
    expect(byId('robot-tools')).toBeNull();
    expect(byId('robot-sensors')).toBeNull();
  });

  it('drives nothing from the keys of the view: there is no teleop', async () => {
    const { render, session } = setup('rb-sandbox');
    await render();
    const stage = host.querySelector<HTMLElement>('.robot-stage')!;
    for (const key of ['ArrowUp', 'w', ' ', 'Escape']) await act(async () => stage.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(stage.getAttribute('role')).toBeNull();
    expect(session.startTeleop).not.toHaveBeenCalled();
    expect(session.teleop).not.toHaveBeenCalled();
    expect(session.start).not.toHaveBeenCalled();
  });

  it('describes the 3D view by its one camera’s keys', async () => {
    const { render } = setup('rb-drive-to-zone');
    await render({ probe: () => ({ ok: true, renderer: 'Google SwiftShader' }) });
    const hint = byId('robot-view-hint');
    expect(hint?.textContent).toBe('Phím: 0 hoặc Home đặt lại góc nhìn; + và − phóng to, thu nhỏ; Shift cùng các phím mũi tên để xoay.');
    expect(byId('robot-scene')?.getAttribute('aria-describedby')).toBe(hint?.id);
    expect(byId('robot-camera')!.querySelectorAll('[data-mode]')).toHaveLength(0);
    expect(byId('robot-quality')!.hidden).toBe(true);
  });

  it('has the lab’s two live regions and no other through a run, Serial output, a message and a check’s result, which the host hears', async () => {
    const { render, publish, world, checks, onCheck } = setup();
    await render();
    await click('robot-run');
    await act(async () => publish({ status: 'running', world: world(2, 60), console: { lines: ['0', '1'], hidden: 0 } }));
    await frame();
    expect(text('console-lines')).toBe('0\n1');
    await act(async () => publish({ status: 'error', error: { message: 'boom', code: 'runtime' } }));
    await frame();
    expect(byId('robot-messages')).not.toBeNull();
    await click('robot-check-start');
    await act(async () => checks.last().check.settle(result));
    await frame();
    expect(byId('robot-check-results')).not.toBeNull();
    expect(onCheck.result).toHaveBeenCalledWith(result);
    const live = [...host.querySelectorAll<HTMLElement>('.robot-lab [aria-live], .robot-lab [role=status], .robot-lab [role=alert]')].filter(
      (element) => element.getAttribute('aria-live') !== 'off' && element.closest('.robot-program') === null,
    );
    expect(live.map((element) => element.dataset.testid)).toEqual(['robot-check-announce', 'robot-alert-announce']);
  });
});
