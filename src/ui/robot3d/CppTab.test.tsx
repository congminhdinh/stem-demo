// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { productionProfiles } from '../../core/profiles';
import { packs, registry } from '../../core/program/__fixtures__/uno-blocks';
import { num, print } from '../../core/program/__fixtures__/ybc-blocks';
import { unoDocument } from '../../core/profiles/__fixtures__/uno-document';
import { program } from '../../core/program/__fixtures__/ybc-blocks';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument, type RobotTemplateKey } from '../../samples/robot-templates';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { fakeSession } from './__fixtures__/fake-session';
import { sketchOf } from './cpp-code';
import { CPP_DEBOUNCE_MS, CppTab } from './CppTab';
import { createRobotRunStore } from './robot-run-store';

// N18 R4.5: the C++ tab of the robot lab, in jsdom: the golden sketch of a pilot lesson's reference solution, regenerated after a pause,
// the diagnostics instead of an older sketch, the lines of the running and of the selected block marked and scrolled into sight, Copy,
// "Tải .ino", and the one line that says what the code has and has not been through.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The generator is the real one; the mock only counts its calls.
vi.mock('./cpp-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cpp-code')>();
  return { ...actual, sketchOf: vi.fn(actual.sketchOf) };
});

const kit = productionKits.get(referenceKitRef) as Kit;
const rules = { registry, profiles: productionProfiles, packs, kits: productionKits };
const golden = (key: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'robot-solutions', `${key}.ino`), 'utf8');
const solved = (key: Exclude<RobotTemplateKey, 'rb-sandbox'>): ProjectDocument => ({ ...robotStarterDocument(key), program: { blocks: robotSolutions[key].reference } });

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  vi.mocked(sketchOf).mockClear();
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const text = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? null;
const button = (testId: string) => host.querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)!;
const lineElements = () => [...host.querySelectorAll<HTMLElement>('[data-testid=cpp-source] .cpp-line')];
const marked = (name: 'running' | 'selected') => lineElements().filter((line) => line.dataset[name] === 'true').map((line) => Number(line.dataset.line));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

type Setup = { key?: RobotTemplateKey; document?: ProjectDocument; starter?: unknown; locale?: 'vi' | 'en'; active?: boolean; selectedIds?: readonly string[]; flush?: () => void };

function setup(options: Setup = {}) {
  const key = options.key ?? 'rb-drive-to-zone';
  const scenario = scenarioCatalog.get(key)!;
  const shown = options.starter === undefined ? scenario : { key: scenario.key, version: scenario.version, starter: options.starter };
  const projectStore = createProjectStore(options.document ?? solved('rb-drive-to-zone'));
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session, { requestFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number, cancelFrame: (handle) => clearTimeout(handle) });
  store.getState().connect();
  const flush = options.flush ?? vi.fn();
  /** How many times the tab has committed to the screen (a render that changed it). */
  const commits = { count: 0 };
  const render = (changes: Partial<Setup> = {}) =>
    act(() =>
      root.render(
        <TextProvider locale={changes.locale ?? options.locale ?? 'vi'}>
          <Profiler id="cpp" onRender={() => void commits.count++}>
            <CppTab projectStore={projectStore} rules={rules} scenario={shown} flush={flush} store={store} selectedIds={changes.selectedIds ?? options.selectedIds ?? []} active={changes.active ?? options.active ?? true} />
          </Profiler>
        </TextProvider>,
      ),
    );
  return { ...fake, scenario, projectStore, store, flush, render, commits };
}

/** The block the robot is in, as the world says it; the store hands it to the tab within a frame. */
async function runningIn(fake: ReturnType<typeof setup>, blockId: string | null) {
  act(() => fake.publish({ status: 'running', world: fake.world(0, undefined, { activeBlockId: blockId }) }));
  await advance(20);
}

describe('CppTab: the code (N18 R4.5)', () => {
  it('shows the golden sketch of the reference solution of a pilot lesson, read-only, with a line number on each line', async () => {
    const { render } = setup();
    await render();
    const source = host.querySelector('[data-testid=cpp-source]')!;
    expect(source.tagName).toBe('PRE');
    expect(source.textContent).toBe(golden('rb-drive-to-zone'));
    expect(lineElements().map((line) => Number(line.dataset.line))).toEqual(Array.from({ length: golden('rb-drive-to-zone').split('\n').length - 1 }, (_, index) => index + 1));
    expect(source.getAttribute('contenteditable')).toBeNull();
    expect(source.getAttribute('aria-label')).toBe('Mã C++ của chương trình');
    expect(text('cpp-file')).toBe('rb-drive-to-zone.ino');
    expect(text('cpp-copy')).toBe('Sao chép');
    expect(text('cpp-download')).toBe('Tải .ino');
  });

  it.each(['rb-square-route', 'rb-line-follow'] as const)('shows the golden sketch of %s too', async (key) => {
    const { render } = setup({ key, document: solved(key) });
    await render();
    expect(text('cpp-source')).toBe(golden(key));
    expect(text('cpp-file')).toBe(`${key}.ino`);
  });

  it('shows the scenario’s starter while the project has no program, as the editor does, and the project’s own program once it has one', async () => {
    // The starters of the pilot lessons hold only loose blocks (no code); this one holds a program, to tell it from an empty sketch.
    const starter = robotSolutions['rb-drive-to-zone'].reference;
    const { render, projectStore } = setup({ document: robotStarterDocument('rb-drive-to-zone'), starter });
    await render();
    expect(text('cpp-source')).toBe(golden('rb-drive-to-zone'));
    expect(projectStore.getState().document.program.blocks).toEqual({});
    act(() => projectStore.getState().setProgramBlocks(robotSolutions['rb-square-route'].reference));
    await advance(CPP_DEBOUNCE_MS + 10);
    expect(text('cpp-source')).toBe(golden('rb-square-route').replace('rb-square-route@1', 'rb-drive-to-zone@1'));
  });

  it('writes nothing while its tab is not shown, and the sketch when it is', async () => {
    const { render } = setup({ active: false });
    await render();
    expect(host.querySelector('[data-testid=cpp-source]')).toBeNull();
    await render({ active: true });
    expect(text('cpp-source')).toBe(golden('rb-drive-to-zone'));
  });

  it('says the code is checked with arduino-cli at level L2, without a claim of full compatibility, in both languages', async () => {
    const { render } = setup();
    await render();
    expect(text('cpp-footer')).toBe('Mã dựng từ các mẫu lệnh đã biên dịch và kiểm bằng arduino-cli (mức L2). Chưa chạy thử trên bo mạch thật.');
    await render({ locale: 'en' });
    expect(text('cpp-footer')).toBe('Built from forms that are compiled and checked with arduino-cli (level L2). It has not run on a real board yet.');
    expect(text('cpp-footer')).not.toMatch(/100|compatible|tương thích/i);
  });
});

describe('CppTab: a tab that is not shown (N18 R4.5 fix round 1)', () => {
  it('does not render for the robot’s block or for the project, and does when it is shown', async () => {
    const fake = setup({ active: false });
    await fake.render();
    const before = fake.commits.count;
    await runningIn(fake, 'drive-time');
    await advance(150);
    await runningIn(fake, 'stop');
    act(() => fake.projectStore.getState().setProgramBlocks(robotSolutions['rb-square-route'].reference));
    await advance(CPP_DEBOUNCE_MS * 2);
    expect(fake.commits.count).toBe(before);
    // The same events, with the tab shown, are what it renders for.
    await fake.render({ active: true });
    const shown = fake.commits.count;
    await advance(150);
    await runningIn(fake, 'drive-time');
    expect(fake.commits.count).toBeGreaterThan(shown);
  });
});

describe('CppTab: its timers (N18 R4.5 fix round 1)', () => {
  it('leaves none behind when it unmounts a moment after Copy, and none after a refused Copy either', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    const { render } = setup();
    await render();
    await act(async () => button('cpp-copy').click());
    expect(text('cpp-copy')).toBe('Đã chép');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);

    writeText.mockImplementation(async () => Promise.reject(new Error('denied')));
    await render();
    await act(async () => button('cpp-copy').click());
    expect(text('cpp-copy-status')).not.toBe('');
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });

  it('Copy twice in a row keeps one feedback timer, so that the first does not end the second’s', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    const { render } = setup();
    await render();
    await act(async () => button('cpp-copy').click());
    await advance(1000);
    await act(async () => button('cpp-copy').click());
    await advance(1000);
    // 2 s since the first, 1 s since the second: still said.
    expect(text('cpp-copy')).toBe('Đã chép');
    await advance(600);
    expect(text('cpp-copy')).toBe('Sao chép');
  });
});

describe('CppTab: following the program (N18 R4.5)', () => {
  it('regenerates after the learner pauses, not at every change, and never writes the editor into the project by itself', async () => {
    const { render, projectStore, flush } = setup();
    await render();
    act(() => projectStore.getState().setProgramBlocks(robotSolutions['rb-square-route'].reference));
    await advance(CPP_DEBOUNCE_MS - 10);
    expect(text('cpp-source')).toBe(golden('rb-drive-to-zone'));
    await advance(20);
    expect(text('cpp-source')).toBe(golden('rb-square-route').replace('rb-square-route@1', 'rb-drive-to-zone@1'));
    // Only Copy and Tải .ino flush the blocks (the host would hear of a project change); looking at the code does not.
    expect(flush).not.toHaveBeenCalled();
  });

  it('waits again for each change, so that a run of edits generates once', async () => {
    const { render, projectStore } = setup();
    await render();
    const before = vi.mocked(sketchOf).mock.calls.length;
    for (const reference of ['rb-square-route', 'rb-line-follow', 'rb-square-route'] as const) {
      act(() => projectStore.getState().setProgramBlocks(robotSolutions[reference].reference));
      await advance(CPP_DEBOUNCE_MS / 2);
    }
    expect(vi.mocked(sketchOf).mock.calls.length).toBe(before);
    await advance(CPP_DEBOUNCE_MS);
    expect(vi.mocked(sketchOf).mock.calls.length).toBe(before + 1);
  });

  it('shows why there is no sketch instead of an older one, and no Copy or download', async () => {
    const { render, projectStore } = setup();
    await render();
    expect(text('cpp-source')).not.toBeNull();
    act(() => projectStore.getState().setProgramBlocks(program([print(num(2 ** 40))], undefined, ['x'])));
    await advance(CPP_DEBOUNCE_MS + 10);
    expect(host.querySelector('[data-testid=cpp-source]')).toBeNull();
    expect(text('cpp-diagnostics')).toBe('Chương trình có lỗi nên chưa có mã C++. Hãy sửa các khối có dấu cảnh báo.Lỗi: Số phải nằm trong khoảng -2147483648 tới 2147483647.');
    expect(button('cpp-copy').disabled).toBe(true);
    expect(button('cpp-download').disabled).toBe(true);
    // The program is mended: the sketch is back.
    act(() => projectStore.getState().setProgramBlocks(robotSolutions['rb-drive-to-zone'].reference));
    await advance(CPP_DEBOUNCE_MS + 10);
    expect(text('cpp-source')).toBe(golden('rb-drive-to-zone'));
    expect(button('cpp-copy').disabled).toBe(false);
  });

  it('says the reason in English too, and for a kit it does not know', async () => {
    const { render } = setup({ locale: 'en', document: unoDocument('uno-basic', { kit: { id: 'nope', version: '9' }, program: { blocks: program([], undefined, ['x']) } }) });
    await render();
    expect(text('cpp-diagnostics')).toContain('The project cannot be opened.');
    expect(text('cpp-diagnostics')).toContain('The robot kit "nope@9" is not one this app knows.');
  });
});

describe('CppTab: the blocks on their lines (N18 R4.5, C1’s lineMap)', () => {
  /** The 1-based line of the sketch with exactly this text. */
  const lineOf = (code: string) => golden('rb-drive-to-zone').split('\n').indexOf(code) + 1;

  it('marks the lines of the block the robot is in, and moves the mark with it', async () => {
    const fake = setup();
    await fake.render();
    expect(marked('running')).toEqual([]);
    await runningIn(fake, 'drive-time');
    expect(lineOf('  delay(5000L);')).toBeGreaterThan(0);
    expect(marked('running')).toEqual([lineOf('  delay(5000L);')]);
    await advance(150);
    await runningIn(fake, 'stop');
    const stopLines = marked('running');
    expect(stopLines).toEqual([lineOf('  motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0L);'), lineOf('  motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, 0L);')]);
    await advance(150);
    await runningIn(fake, null);
    expect(marked('running')).toEqual([]);
  });

  it('marks nothing for a block the sketch has no code for (the starter’s, after the program changed)', async () => {
    const fake = setup();
    await fake.render();
    await runningIn(fake, 'a-block-of-another-program');
    expect(marked('running')).toEqual([]);
  });

  it('marks the lines of the selected block, or of the first block around it that has code', async () => {
    const { render } = setup();
    await render({ selectedIds: ['drive-time'] });
    expect(marked('selected')).toEqual([lineOf('  delay(5000L);')]);
    await render({ selectedIds: ['drive-time-ms', 'drive-time'] });
    expect(marked('selected')).toEqual([lineOf('  delay(5000L);')]);
    await render({ selectedIds: [] });
    expect(marked('selected')).toEqual([]);
  });

  it('marks all the lines of a block that holds others, as C1’s map says', async () => {
    const { render } = setup({ document: solved('rb-square-route') });
    await render({ selectedIds: ['square'] });
    const lines = marked('selected');
    expect(lines.length).toBeGreaterThan(8);
    expect(lines).toEqual(Array.from({ length: lines.length }, (_, index) => lines[0]! + index));
    const sketch = text('cpp-source')!.split('\n');
    expect(lines.some((line) => /for \(long _r/.test(sketch[line - 1]!))).toBe(true);
  });

  it('marks the running block and the selected block as two different things', async () => {
    const fake = setup({ selectedIds: ['go'] });
    await fake.render();
    await runningIn(fake, 'drive-time');
    const [running] = marked('running');
    expect(marked('selected')).not.toContain(running);
    expect(lineElements().find((line) => line.dataset.line === String(running))?.dataset.selected).toBe('false');
  });

  it('scrolls the marked lines into sight: the running block’s, and the selected block’s', async () => {
    // jsdom lays nothing out: a 200 px view over lines 20 px tall.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const line = this.dataset.line === undefined ? null : Number(this.dataset.line);
      const scrolled = this.closest<HTMLElement>('.cpp-source')?.scrollTop ?? 0;
      const top = line === null ? 0 : (line - 1) * 20 - scrolled;
      return { top, bottom: top + (line === null ? 0 : 20), left: 0, right: 0, width: 0, height: line === null ? 0 : 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const fake = setup();
    await fake.render();
    const view = () => host.querySelector<HTMLElement>('[data-testid=cpp-source]')!;
    expect(view().scrollTop).toBe(0);
    const wait = lineOf('  delay(5000L);');
    await runningIn(fake, 'drive-time');
    // The wait's line is 20 px × (line − 1) down the sketch: scrolled so that it is in the view with the margin under it.
    expect(wait * 20).toBeGreaterThan(200);
    expect(view().scrollTop).toBe(wait * 20 - 200 + 24);
    // The learner selects the block of the last lines, below the view: scrolled down to its end, with the margin under it.
    const stopEnd = lineOf('  motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, 0L);');
    await fake.render({ selectedIds: ['stop'] });
    expect(view().scrollTop).toBe(stopEnd * 20 - 200 + 24);
    // And the one at the top of the program, above the view: scrolled up to its start, with the margin over it.
    const go = lineOf('    const long _s = (50L);') - 1;
    await fake.render({ selectedIds: ['go'] });
    expect(view().scrollTop).toBe((go - 1) * 20 - 24);
  });
});

describe('CppTab: Copy and download (N18 R4.5)', () => {
  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  it('copies the sketch, saying so for a moment', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...window.navigator, platform: 'MacIntel', clipboard: { writeText } });
    const { render } = setup();
    await render();
    await act(async () => button('cpp-copy').click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(golden('rb-drive-to-zone'));
    expect(text('cpp-copy')).toBe('Đã chép');
    await advance(1600);
    expect(text('cpp-copy')).toBe('Sao chép');
  });

  it('writes the blocks into the project first and copies what they make now, not what is shown, as the Python panel does', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    const projectStoreRef: { current?: ReturnType<typeof setup>['projectStore'] } = {};
    const flush = vi.fn(() => projectStoreRef.current?.getState().setProgramBlocks(robotSolutions['rb-square-route'].reference));
    const fake = setup({ flush });
    projectStoreRef.current = fake.projectStore;
    await fake.render();
    await act(async () => button('cpp-copy').click());
    expect(flush).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(golden('rb-square-route').replace('rb-square-route@1', 'rb-drive-to-zone@1'));
    // And the tab shows it at once, not after the pause.
    expect(text('cpp-source')).toBe(golden('rb-square-route').replace('rb-square-route@1', 'rb-drive-to-zone@1'));
  });

  it('selects the code and says how to copy it when the clipboard is refused', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, platform: 'Win32', clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    // jsdom empties a selection when an element is focused, which a browser does not.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {});
    const { render } = setup();
    await render();
    await act(async () => button('cpp-copy').click());
    expect(text('cpp-copy-status')).toBe('Không sao chép được. Nhấn Ctrl+C để chép đoạn mã đã chọn.');
    await advance(10);
    expect(window.getSelection()?.toString()).toBe(golden('rb-drive-to-zone'));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('downloads the sketch as <scenario key>.ino', async () => {
    const blobs: Blob[] = [];
    // jsdom has no object URLs.
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:sketch'), revokeObjectURL: revoke });
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    const { render, flush } = setup();
    await render();
    await act(async () => button('cpp-download').click());
    expect(flush).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([{ download: 'rb-drive-to-zone.ino', href: 'blob:sketch' }]);
    expect(blobs).toHaveLength(1);
    // FileReader runs on the real timers.
    vi.useRealTimers();
    expect(await readBlob(blobs[0]!)).toBe(golden('rb-drive-to-zone'));
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:sketch');
  });
});
