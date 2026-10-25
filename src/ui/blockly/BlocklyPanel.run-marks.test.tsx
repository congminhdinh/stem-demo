// @vitest-environment jsdom
import * as Blockly from 'blockly';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { buildToolbox, createBlockPackCatalog, ybcStructurePackId } from '../../core/program/block-packs';
import { print, program, setVar, text, num } from '../../core/program/__fixtures__/ybc-blocks';
import { createProjectStore, type ProjectStore } from '../state/project-store';
import { BlocklyPanel, highlightDelayMs } from './BlocklyPanel';

// N18 R2.4: what the robot lab shows of a run on the blocks, through the two props of the panel: the block the program is in
// (`highlightBlockId`, debounced, Blockly's own highlight) and the warnings of diagnostics that name a block (`blockWarnings`).
// Real Blockly, drawn in jsdom: the marks are read from the blocks' SVG and icons, not from a mock.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const toolbox = buildToolbox([ybcStructurePackId], packs);

const first = print(text('first'));
const second = print(text('second'));
const third = setVar('x', num(1));
const firstId = first.id as string;
const secondId = second.id as string;
const thirdId = third.id as string;

const documentOf = (): ProjectDocument => ({
  schemaVersion: 1,
  id: 'run-marks',
  name: 'Run marks',
  profile: 'ybc-basic',
  circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks: program([first, second, third]) },
});

let container: HTMLElement;
let root: Root;
let store: ProjectStore;

beforeEach(() => {
  // Blockly measures text and the container; jsdom lays nothing out, so give it sizes that are good enough to draw.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const svg = SVGElement.prototype as unknown as Record<string, unknown>;
  svg.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
  svg.getComputedTextLength = () => 40;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ font: '', measureText: (value: string) => ({ width: value.length * 7 }) })) as never);
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  store = createProjectStore(documentOf());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Props = { highlightBlockId?: string | null; blockWarnings?: Readonly<Record<string, string>> };

const render = (props: Props = {}) => act(async () => root.render(<BlocklyPanel projectStore={store} packs={packs} toolbox={toolbox} {...props} />));
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const workspace = () => Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
const block = (id: string) => {
  const found = workspace().getBlockById(id);
  if (!found) {
    throw new Error(`No block ${id}`);
  }
  return found as Blockly.BlockSvg;
};
/** The ids of the blocks Blockly draws as highlighted. */
const lit = () => [...container.querySelectorAll('g.blocklyHighlighted')].map((element) => element.getAttribute('data-id'));
/** The text of the warning icon of a block, or null when it has none. */
const warningOf = (id: string) => {
  const icon = block(id).getIcon(Blockly.icons.IconType.WARNING.toString()) as Blockly.icons.WarningIcon | undefined;
  return icon ? icon.getText() : null;
};

describe('BlocklyPanel highlightBlockId (N18 R2.4)', () => {
  it('highlights the block after 100 ms, moves the highlight to the next block, and null clears it', async () => {
    await render({ highlightBlockId: null });
    expect(lit()).toEqual([]);

    await render({ highlightBlockId: firstId });
    await wait(highlightDelayMs - 1);
    expect(lit()).toEqual([]);
    await wait(1);
    expect(lit()).toEqual([firstId]);

    await render({ highlightBlockId: secondId });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([secondId]);

    await render({ highlightBlockId: null });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([]);
  });

  it('is debounced: ids that change faster than 100 ms are not shown, only the one that stays', async () => {
    await render({ highlightBlockId: null });
    const highlight = vi.spyOn(Blockly.WorkspaceSvg.prototype, 'highlightBlock');
    await render({ highlightBlockId: firstId });
    await wait(60);
    await render({ highlightBlockId: secondId });
    await wait(60);
    // 120 ms after the first change, but the id changed again 60 ms ago: nothing has been shown yet.
    expect(highlight).not.toHaveBeenCalled();
    expect(lit()).toEqual([]);
    await render({ highlightBlockId: thirdId });
    await wait(highlightDelayMs);
    expect(highlight.mock.calls).toEqual([[thirdId]]);
    expect(lit()).toEqual([thirdId]);
    // Going back to what is already shown does nothing at all.
    await render({ highlightBlockId: firstId });
    await wait(50);
    await render({ highlightBlockId: thirdId });
    await wait(200);
    expect(highlight).toHaveBeenCalledTimes(1);
    highlight.mockRestore();
  });

  it('an id the workspace does not have shows nothing and throws nothing; a highlighted block that was deleted is cleared by the next id', async () => {
    await render({ highlightBlockId: 'no-such-block' });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([]);

    await render({ highlightBlockId: secondId });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([secondId]);

    // Deleted mid-run: the program on screen no longer has the block the robot is in.
    await act(async () => void block(secondId).dispose(true));
    await render({ highlightBlockId: 'no-such-block' });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([]);
    await render({ highlightBlockId: thirdId });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([thirdId]);
    await render({ highlightBlockId: null });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([]);
  });

  it('a block that is deleted while it is the highlighted one does not make the next change throw', async () => {
    await render({ highlightBlockId: firstId });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([firstId]);
    await act(async () => void block(firstId).dispose(true));
    await render({ highlightBlockId: thirdId });
    await expect(wait(highlightDelayMs)).resolves.toBeUndefined();
    expect(lit()).toEqual([thirdId]);
  });

  it('a Blockly that throws while it highlights is a warning in the console, not a crash, and the next change is shown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const highlight = vi.spyOn(Blockly.WorkspaceSvg.prototype, 'highlightBlock');
    highlight.mockImplementationOnce(() => {
      throw new Error('Blockly could not.');
    });
    await render({ highlightBlockId: firstId });
    await expect(wait(highlightDelayMs)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    await render({ highlightBlockId: secondId });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([secondId]);
  });

  it('is not part of the document: neither the saved workspace nor the stored program changes, however long the run lights blocks', async () => {
    await render({ highlightBlockId: null });
    const savedWorkspace = () => JSON.stringify(Blockly.serialization.workspaces.save(workspace()));
    const stored = JSON.stringify(store.getState().document.program.blocks);
    const saved = savedWorkspace();
    await render({ highlightBlockId: firstId });
    await wait(highlightDelayMs);
    await render({ highlightBlockId: secondId });
    await wait(highlightDelayMs + 1000);
    expect(lit()).toEqual([secondId]);
    expect(savedWorkspace()).toBe(saved);
    expect(JSON.stringify(store.getState().document.program.blocks)).toBe(stored);
  });

  it('is put back on the new workspace when another project is loaded', async () => {
    await render({ highlightBlockId: secondId });
    await wait(highlightDelayMs);
    expect(lit()).toEqual([secondId]);
    await act(async () => store.getState().loadProject(documentOf()));
    await wait(0);
    expect(lit()).toEqual([secondId]);
  });
});

describe('BlocklyPanel blockWarnings (N18 R2.4)', () => {
  it('puts the text on the block as a warning, changes it, and takes it off when the block leaves the record or the record goes', async () => {
    await render();
    expect(warningOf(firstId)).toBeNull();

    await render({ blockWarnings: { [firstId]: 'Không tìm thấy cảm biến.', [secondId]: 'Chân D3 đang bị dùng.' } });
    expect(warningOf(firstId)).toBe('Không tìm thấy cảm biến.');
    expect(warningOf(secondId)).toBe('Chân D3 đang bị dùng.');
    expect(warningOf(thirdId)).toBeNull();

    await render({ blockWarnings: { [firstId]: 'Đã đổi.' } });
    expect(warningOf(firstId)).toBe('Đã đổi.');
    expect(warningOf(secondId)).toBeNull();

    await render({ blockWarnings: {} });
    expect(warningOf(firstId)).toBeNull();

    await render({ blockWarnings: { [thirdId]: 'Cuối.' } });
    expect(warningOf(thirdId)).toBe('Cuối.');
    await render();
    expect(warningOf(thirdId)).toBeNull();
  });

  it('skips an id the workspace does not have, sets it when such a block exists later, and costs nothing for a new record with the same texts', async () => {
    await render({ blockWarnings: { 'no-such-block': 'Nowhere.', [firstId]: 'One.' } });
    expect(warningOf(firstId)).toBe('One.');

    const setWarning = vi.spyOn(Blockly.BlockSvg.prototype, 'setWarningText');
    // A caller that builds a new record on every render: same ids, same texts.
    await render({ blockWarnings: { 'no-such-block': 'Nowhere.', [firstId]: 'One.' } });
    await render({ blockWarnings: { [firstId]: 'One.', 'no-such-block': 'Nowhere.' } });
    expect(setWarning.mock.calls.filter(([, id]) => id !== undefined && id !== 'stem-diagnostics')).toEqual([]);
    expect(setWarning.mock.calls.every(([, id]) => id === 'stem-diagnostics')).toBe(true);
    expect(warningOf(firstId)).toBe('One.');
    setWarning.mockRestore();
  });

  it('leaves a warning that a block raised itself alone, and is not saved in the document', async () => {
    await render();
    block(firstId).setWarningText('Own warning.', 'own');
    await render({ blockWarnings: { [firstId]: 'From a diagnostic.' } });
    expect(warningOf(firstId)).toContain('Own warning.');
    expect(warningOf(firstId)).toContain('From a diagnostic.');
    await render({ blockWarnings: {} });
    expect(warningOf(firstId)).toBe('Own warning.');

    await render({ blockWarnings: { [secondId]: 'Not in the document.' } });
    const before = JSON.stringify(store.getState().document.program.blocks);
    await wait(1000);
    expect(JSON.stringify(store.getState().document.program.blocks)).toBe(before);
    expect(JSON.stringify(Blockly.serialization.workspaces.save(workspace()))).not.toContain('Not in the document.');
  });

  it('is put back on the new workspace when another project is loaded, and a block deleted with a warning is no trouble', async () => {
    await render({ blockWarnings: { [firstId]: 'Kept.', [secondId]: 'Also.' } });
    await act(async () => store.getState().loadProject(documentOf()));
    await wait(0);
    expect(warningOf(firstId)).toBe('Kept.');
    expect(warningOf(secondId)).toBe('Also.');

    await act(async () => void block(secondId).dispose(true));
    await render({ blockWarnings: { [firstId]: 'Kept.' } });
    expect(warningOf(firstId)).toBe('Kept.');
  });
});
