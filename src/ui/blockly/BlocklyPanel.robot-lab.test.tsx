// @vitest-environment jsdom
import * as Blockly from 'blockly';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { buildToolbox, createBlockPackCatalog, ybcStructurePackId } from '../../core/program/block-packs';
import { num, print, program, repeat, text } from '../../core/program/__fixtures__/ybc-blocks';
import { createProjectStore, type ProjectStore } from '../state/project-store';
import { BlocklyPanel, highlightDelayMs, isEmptyProgram, type BlocklyPanelHandle } from './BlocklyPanel';

// N18 R4.2: what the robot lab adds to the block editor. A scenario's starter is shown when the project has no program, and is not
// written to the document (so the host hears of no edit) until the learner changes it or runs it; a check locks editing (`readOnly`);
// and the block the robot is in is shown on the outermost collapsed block around it when it is hidden inside one.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const toolbox = buildToolbox([ybcStructurePackId], packs);

const inner = print(text('inside'));
const loop = repeat(num(3), [inner]);
const after = print(text('after'));
const innerId = inner.id as string;
const loopId = loop.id as string;
const afterId = after.id as string;
const starter = program([print(text('starter'))]);

const documentOf = (blocks: unknown): ProjectDocument => ({
  schemaVersion: 1,
  id: 'robot-panel',
  name: 'Robot panel',
  profile: 'ybc-basic',
  circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks },
});

let container: HTMLElement;
let root: Root;
let store: ProjectStore;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const svg = SVGElement.prototype as unknown as Record<string, unknown>;
  svg.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
  svg.getComputedTextLength = () => 40;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ font: '', measureText: (value: string) => ({ width: value.length * 7 }) })) as never);
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Props = { readOnly?: boolean; emptyProgram?: unknown; highlightBlockId?: string | null };
const panel = createRef<BlocklyPanelHandle>();
const render = (props: Props = {}) => act(async () => root.render(<BlocklyPanel ref={panel} projectStore={store} packs={packs} toolbox={toolbox} {...props} />));
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const workspace = () => Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
const lit = () => [...container.querySelectorAll('g.blocklyHighlighted')].map((element) => element.getAttribute('data-id'));
const shownTexts = () =>
  workspace()
    .getAllBlocks(true)
    .filter((block) => block.type === 'text')
    .map((block) => block.getFieldValue('TEXT'));

describe('BlocklyPanel emptyProgram (N18 R4.2)', () => {
  it('shows the starter when the document has no program, and leaves the document empty while nothing changes', async () => {
    store = createProjectStore(documentOf({}));
    await render({ emptyProgram: starter });
    expect(shownTexts()).toEqual(['starter']);
    // The events of the load itself, as Blockly fires them a frame later (the fake timers run no animation frame).
    act(() => workspace().getTopBlocks(false).forEach((block) => workspace().fireChangeListener(new Blockly.Events.BlockCreate(block))));
    await wait(1000);
    expect(store.getState().document.program.blocks).toEqual({});
  });

  it('writes the starter and the edit to the document once the learner changes it', async () => {
    store = createProjectStore(documentOf({}));
    await render({ emptyProgram: starter });
    await act(async () => {
      const block = workspace().newBlock('text_print');
      block.initSvg();
      block.render();
      // Blockly fires its events from an animation frame, which the fake timers do not run: hand the panel the event now.
      workspace().fireChangeListener(new Blockly.Events.BlockCreate(block));
    });
    await wait(1000);
    const saved = JSON.stringify(store.getState().document.program.blocks);
    expect(saved).toContain('"starter"');
    expect(saved.match(/"text_print"/g)).toHaveLength(2);
  });

  it('writes what is shown on saveNow (Run compiles what the learner sees)', async () => {
    store = createProjectStore(documentOf({}));
    await render({ emptyProgram: starter });
    act(() => panel.current?.saveNow());
    expect(JSON.stringify(store.getState().document.program.blocks)).toContain('"starter"');
  });

  it('shows the document’s own program when it has one', async () => {
    store = createProjectStore(documentOf(program([after])));
    await render({ emptyProgram: starter });
    expect(shownTexts()).toEqual(['after']);
  });

  it('tells an empty program: what Blockly saves for an empty workspace, or a workspace without blocks', () => {
    expect(isEmptyProgram({})).toBe(true);
    expect(isEmptyProgram(undefined)).toBe(true);
    expect(isEmptyProgram({ blocks: { languageVersion: 0, blocks: [] } })).toBe(true);
    expect(isEmptyProgram(starter)).toBe(false);
    expect(isEmptyProgram({ variables: [{ name: 'x', id: 'x' }] })).toBe(false);
  });
});

describe('BlocklyPanel readOnly (N18 R4.2)', () => {
  it('locks and unlocks the workspace, and a project loaded while locked opens locked', async () => {
    store = createProjectStore(documentOf(program([after])));
    await render({ readOnly: true });
    expect(workspace().isReadOnly()).toBe(true);
    await render({ readOnly: false });
    expect(workspace().isReadOnly()).toBe(false);
    await render({ readOnly: true });
    await act(async () => store.getState().loadProject(documentOf(program([after]))));
    expect(workspace().isReadOnly()).toBe(true);
  });
});

describe('BlocklyPanel highlight of a hidden block (N18 R4.2, the R2.4 carry)', () => {
  it('lights the outermost collapsed block around the running one, and a block after a collapsed one is lit itself', async () => {
    store = createProjectStore(documentOf(program([loop, after])));
    await render({ highlightBlockId: null });
    await act(async () => void (workspace().getBlockById(loopId) as Blockly.BlockSvg).setCollapsed(true));
    await render({ highlightBlockId: innerId });
    expect(lit()).toEqual([loopId]);
    await wait(highlightDelayMs);
    await render({ highlightBlockId: afterId });
    expect(lit()).toEqual([afterId]);
    await wait(highlightDelayMs);
    await act(async () => void (workspace().getBlockById(loopId) as Blockly.BlockSvg).setCollapsed(false));
    await render({ highlightBlockId: innerId });
    expect(lit()).toEqual([innerId]);
  });

  it('moves the highlight when the learner folds or unfolds a block while the robot stays in a block inside it', async () => {
    store = createProjectStore(documentOf(program([loop, after])));
    await render({ highlightBlockId: innerId });
    expect(lit()).toEqual([innerId]);
    const fold = (collapsed: boolean) =>
      act(async () => {
        const block = workspace().getBlockById(loopId) as Blockly.BlockSvg;
        block.setCollapsed(collapsed);
        // Blockly fires its events from an animation frame, which the fake timers do not run: hand the panel the event now.
        workspace().fireChangeListener(new Blockly.Events.BlockChange(block, 'collapsed', null, !collapsed, collapsed));
      });
    await fold(true);
    expect(lit()).toEqual([loopId]);
    await fold(false);
    expect(lit()).toEqual([innerId]);
  });
});
