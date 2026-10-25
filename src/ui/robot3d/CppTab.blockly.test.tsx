// @vitest-environment jsdom
import * as Blockly from 'blockly';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox } from '../../core/program/block-packs';
import { packs, registry } from '../../core/program/__fixtures__/uno-blocks';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument } from '../../samples/robot-templates';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { fakeSession } from './__fixtures__/fake-session';
import { CppTab } from './CppTab';
import { createRobotRunStore } from './robot-run-store';

// N18 R4.5 fix round 1: the C++ tab on the REAL block editor (not a stub of it), as the robot lab puts them side by side. Copy and
// "Tải .ino" write the learner's edits into the project before they generate, and never an untouched starter (R4.2: the host hears of no
// project change that nobody made); and a block the learner selects marks its lines.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get(referenceKitRef) as Kit;
const rules = { registry, profiles: productionProfiles, packs, kits: productionKits };
const toolbox = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);
const golden = readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'robot-solutions', 'rb-drive-to-zone.ino'), 'utf8');
/** The scenario's starter here is the lesson's reference solution, so that the sketch of an untouched starter is a golden with code in it. */
const starter = robotSolutions['rb-drive-to-zone'].reference;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const svg = SVGElement.prototype as unknown as Record<string, unknown>;
  svg.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
  svg.getComputedTextLength = () => 40;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ font: '', measureText: (value: string) => ({ width: value.length * 7 }) })) as never);
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? null;
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const workspace = () => Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
const marked = () => [...host.querySelectorAll<HTMLElement>('[data-testid=cpp-source] [data-selected=true]')].map((line) => line.textContent);

async function setup() {
  const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
  const projectStore = createProjectStore(robotStarterDocument('rb-drive-to-zone'));
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session, { requestFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number, cancelFrame: (handle) => clearTimeout(handle) });
  store.getState().connect();
  // The lab's own arrangement: the editor reports the selection, the tab reads it, Copy flushes the edits and never the starter.
  function Harness() {
    const panel = useRef<BlocklyPanelHandle>(null);
    const [selected, setSelected] = useState<readonly string[]>([]);
    return (
      <>
        <BlocklyPanel ref={panel} projectStore={projectStore} packs={packs} toolbox={toolbox} emptyProgram={starter} onSelectBlock={setSelected} />
        <CppTab
          projectStore={projectStore}
          rules={rules}
          scenario={{ key: scenario.key, version: scenario.version, starter }}
          flush={() => panel.current?.saveEdits()}
          store={store}
          selectedIds={selected}
          active
        />
      </>
    );
  }
  await act(async () =>
    root.render(
      <TextProvider locale="vi">
        <Harness />
      </TextProvider>,
    ),
  );
  /** What the project store is told, one entry for each change of the document. */
  const changes: unknown[] = [];
  projectStore.subscribe((state, previous) => {
    if (state.document !== previous.document) changes.push(state.document.program.blocks);
  });
  return { projectStore, changes };
}

/** The learner puts one more "stop the robot" block after the lesson's own, as Blockly tells the editor of it (a frame later in a browser). */
const addStop = () =>
  act(async () => {
    const stop = workspace().getBlockById('stop')!;
    const extra = workspace().newBlock('uno_drive_stop');
    extra.initSvg();
    extra.render();
    stop.nextConnection!.connect(extra.previousConnection!);
    workspace().fireChangeListener(new Blockly.Events.BlockCreate(extra));
  });

const select = (blockId: string | null) => act(async () => workspace().fireChangeListener(new Blockly.Events.Selected(null, blockId, workspace().id)));

describe('CppTab with the real block editor (N18 R4.5 fix round 1)', () => {
  it('shows the sketch of the starter the editor shows, and Copy on it changes nothing in the project and tells the host nothing', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    const { projectStore, changes } = await setup();
    expect(text('cpp-source')).toBe(golden);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=cpp-copy]')!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(golden);
    expect(projectStore.getState().document.program.blocks).toEqual({});
    expect(changes).toEqual([]);
    await advance(2000);
    expect(changes).toEqual([]);
  });

  it('Tải .ino on an untouched starter changes nothing in the project either', async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, { createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:sketch'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { projectStore, changes } = await setup();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=cpp-download]')!.click());
    expect(blobs).toHaveLength(1);
    expect(projectStore.getState().document.program.blocks).toEqual({});
    expect(changes).toEqual([]);
  });

  it('Copy after an edit saves that edit at once, and copies the sketch of it, not the one shown before', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    const { projectStore, changes } = await setup();
    await addStop();
    // The editor's own delayed save and the tab's pause have not run: the project still has no program, and the tab shows the old sketch.
    expect(projectStore.getState().document.program.blocks).toEqual({});
    expect(text('cpp-source')).toBe(golden);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=cpp-copy]')!.click());
    expect(changes).toHaveLength(1);
    expect(JSON.stringify(projectStore.getState().document.program.blocks).match(/"uno_drive_stop"/g)).toHaveLength(2);
    const copied = writeText.mock.calls[0]![0];
    // The lesson's own stop is two calls of motorSet(…, 0L); the extra one adds two more.
    expect(golden.match(/, 0L\);/g)).toHaveLength(2);
    expect(copied.match(/, 0L\);/g)).toHaveLength(4);
    expect(text('cpp-source')).toBe(copied);
  });

  it('marks the lines of the block the learner selects, the lines of the block around it for a number typed into it, and none when nothing is', async () => {
    await setup();
    expect(marked()).toEqual([]);
    await select('drive-time');
    expect(marked()).toEqual(['  delay(5000L);']);
    await select('go');
    expect(marked()).toEqual(['  {', '    const long _s = (50L);', '    motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, _s);', '    motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, _s);', '  }']);
    // The number inside the wait block is what a click on its field selects.
    await select('drive-time-ms');
    expect(marked()).toEqual(['  delay(5000L);']);
    await select(null);
    expect(marked()).toEqual([]);
  });
});
