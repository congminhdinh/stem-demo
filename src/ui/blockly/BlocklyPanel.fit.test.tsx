// @vitest-environment jsdom
import * as Blockly from 'blockly';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { buildToolbox, createBlockPackCatalog, ybcStructurePackId } from '../../core/program/block-packs';
import { print, program, text } from '../../core/program/__fixtures__/ybc-blocks';
import { createProjectStore, type ProjectStore } from '../state/project-store';
import { BlocklyPanel } from './BlocklyPanel';
import { fitBlocksIntoView, minFitScale, minRobotFitScale } from './fit';

// N18 bt-lab-fix (c4): a program the host loads (the LMS's load-project, the learner's last one restored) is brought into view, as the
// lab's own starter is, and only then: the learner's own edits never move the view. A load into an editor that has no size yet (a tab that
// is not shown) is brought into view once it has one. The arithmetic of the fit is fit.test.ts's; this is when the panel does it.

vi.mock('./fit', async (importOriginal) => ({ ...(await importOriginal<typeof import('./fit')>()), fitBlocksIntoView: vi.fn(() => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const toolbox = buildToolbox([ybcStructurePackId], packs);
const fit = vi.mocked(fitBlocksIntoView);

const documentOf = (blocks: unknown): ProjectDocument => ({
  schemaVersion: 1,
  id: 'fit-panel',
  name: 'Fit panel',
  profile: 'ybc-basic',
  circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks },
});

let container: HTMLElement;
let root: Root;
let store: ProjectStore;
/** The callbacks of the ResizeObservers the panel has not disconnected, to say the editor got a size. */
let resizes: (() => void)[];

beforeEach(() => {
  resizes = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        resizes.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizes = resizes.filter((resize) => resize !== this.callback);
      }
    },
  );
  const svg = SVGElement.prototype as unknown as Record<string, unknown>;
  svg.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
  svg.getComputedTextLength = () => 40;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ font: '', measureText: (value: string) => ({ width: value.length * 7 }) })) as never);
  vi.useFakeTimers();
  fit.mockReset();
  fit.mockReturnValue(true);
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

type Props = { fitOnLoad?: boolean; fitMinScale?: number };
const render = (props: Props = {}) => act(async () => root.render(<BlocklyPanel projectStore={store} packs={packs} toolbox={toolbox} {...props} />));
const workspace = () => Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
/** The learner adds a block: Blockly's own events (the fake timers run no animation frame, so the panel is handed the event). */
const learnerAddsABlock = () =>
  act(async () => {
    const block = workspace().newBlock('text_print');
    block.initSvg();
    block.render();
    workspace().fireChangeListener(new Blockly.Events.BlockCreate(block));
  });

describe('BlocklyPanel fitOnLoad (N8s, N18 bt-lab-fix c4)', () => {
  it('fits the program it opens, and the one a host loads later, at the smallest scale the lab gave; not before the load, not on an edit or a render', async () => {
    store = createProjectStore(documentOf(program([print(text('first'))])));
    await render({ fitOnLoad: true, fitMinScale: minRobotFitScale });
    expect(fit.mock.calls.map(([, min]) => min)).toEqual([minRobotFitScale]);
    const first = workspace();
    expect(fit.mock.calls[0]![0]).toBe(first);
    // A host's load-project (or a restore): another document, so a new load.
    await act(async () => store.getState().loadProject(documentOf(program([print(text('restored'))]))));
    expect(fit.mock.calls.map(([, min]) => min)).toEqual([minRobotFitScale, minRobotFitScale]);
    expect(fit.mock.calls[1]![0]).toBe(workspace());
    expect(fit.mock.calls[1]![0]).not.toBe(first);
    // The learner's own edit is saved into the document, which is no load; nor is a render of the panel.
    await learnerAddsABlock();
    await wait(1000);
    expect(JSON.stringify(store.getState().document.program.blocks)).toContain('"text_print"');
    await render({ fitOnLoad: true, fitMinScale: minRobotFitScale });
    await wait(1000);
    expect(fit).toHaveBeenCalledTimes(2);
    // And the editor getting resized (the window, the splitter) is no reason to fit again, as it has been fitted.
    act(() => resizes.forEach((resize) => resize()));
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it('uses the other labs’ smallest scale when none is given, and fits nothing when the launch is not a lab', async () => {
    store = createProjectStore(documentOf(program([print(text('a'))])));
    await render({ fitOnLoad: true });
    expect(fit.mock.calls.map(([, min]) => min)).toEqual([minFitScale]);
    act(() => root.unmount());
    root = createRoot(container);
    fit.mockClear();
    await render();
    await act(async () => store.getState().loadProject(documentOf(program([print(text('b'))]))));
    expect(fit).not.toHaveBeenCalled();
  });

  it('fits a program loaded into an editor with no size yet (a tab that is not shown) once the editor has one, and only once', async () => {
    store = createProjectStore(documentOf(program([print(text('hidden'))])));
    fit.mockReturnValue(false);
    await render({ fitOnLoad: true, fitMinScale: minRobotFitScale });
    expect(fit).toHaveBeenCalledTimes(1);
    // Still no size: the observer fires (it does on any change) and the fit tries again.
    act(() => resizes.forEach((resize) => resize()));
    expect(fit).toHaveBeenCalledTimes(2);
    // It has a size now: fitted, and no more after it.
    fit.mockReturnValue(true);
    act(() => resizes.forEach((resize) => resize()));
    expect(fit).toHaveBeenCalledTimes(3);
    act(() => resizes.forEach((resize) => resize()));
    expect(fit).toHaveBeenCalledTimes(3);
  });

  it('a program loaded into a hidden editor is fitted for its own load: a newer load that was fitted ends the wait of the older one', async () => {
    store = createProjectStore(documentOf(program([print(text('one'))])));
    fit.mockReturnValue(false);
    await render({ fitOnLoad: true });
    fit.mockReturnValue(true);
    await act(async () => store.getState().loadProject(documentOf(program([print(text('two'))]))));
    expect(fit).toHaveBeenCalledTimes(2);
    // Only the workspace of the latest load is left, and it was fitted: the observers of the first one do not fit it again.
    act(() => resizes.forEach((resize) => resize()));
    expect(fit).toHaveBeenCalledTimes(2);
  });
});
