import * as Blockly from 'blockly';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react';
import { useStore } from 'zustand';
import { blockTypes } from '../../core/program/blocks';
import type { BlockPackCatalog, Toolbox } from '../../core/program/block-packs';
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { fitBlocksIntoView } from './fit';
import { createLatestThrottle, type LatestThrottle } from './latest-throttle';
import { blocklyMediaUrl } from './media';
import { stemTheme } from './theme';

// Blockly is only a view of `document.program.blocks` (plan §5.1 B4): the
// workspace is loaded from that JSON and every non-UI change is serialized
// back into the store. No Blockly object ever leaves this file.

const saveDelayMs = 250;

/**
 * N18 R2.4: the highlight changes at most once in this long. The robot reports its active block on every tick and a loop of quick
 * statements changes it faster than anyone can read, so the panel throttles it (latest-throttle.ts): the first change is shown at
 * once, the ones inside the delay are collapsed into the latest, shown when the delay is over. A debounce would never show anything
 * while a tight loop runs.
 */
export const highlightDelayMs = 100;

/** The id of the warnings this panel puts on blocks, so it never clears one a block raised itself (Blockly keeps one text per id). */
const diagnosticWarningId = 'stem-diagnostics';

export type BlocklyPanelHandle = {
  /**
   * Writes the workspace to the document right away. Saving is otherwise
   * delayed (Blockly fires change events a frame late, then the debounce), so
   * Run calls this first to never compile a program older than the screen.
   */
  saveNow(): void;
};

type BlocklyPanelProps = {
  projectStore: ProjectStore;
  /** Every known block pack: all their blocks are registered, so any stored program loads. */
  packs: BlockPackCatalog;
  /** What the learner sees, from the board context. Must be stable: a new one would rebuild the workspace. */
  toolbox: Toolbox;
  /** A lab launch (N8s): every loaded program is shrunk, if needed, so that all its blocks are in sight. */
  fitOnLoad?: boolean;
  /**
   * The document's program did not open in the editor (Fix 6, N17 m2: e.g. a block in an input whose type it does not take). The
   * panel shows nothing and saves nothing for that document, so it is never overwritten; its owner opens another one.
   */
  onLoadFailed?(): void;
  /**
   * N18 R2.4: the block the running program is in (`RobotSnapshot.activeBlockId`), shown with Blockly's own block highlight; `null` or
   * absent shows none. The highlight changes at most once every `highlightDelayMs` and always ends on the latest id (a throttle, not
   * a debounce: a program that never stays in one block still shows where it is). An id the workspace does not have (a block
   * deleted during the run, or one of another program) shows nothing and is not an error. Not part of the document.
   */
  highlightBlockId?: string | null;
  /**
   * N18 R2.4: a warning on each block named, by block id (a diagnostic with a `blockId`: `capability-unavailable`, `pin-conflict`,
   * `timer-claimed`, `pin-unavailable`, a run warning). The text is the caller's, already in the learner's language. A block that
   * leaves the record, or a record that is absent, has its warning taken off; an id the workspace does not have is skipped. Not part of
   * the document.
   */
  blockWarnings?: Readonly<Record<string, string>>;
  /**
   * N18 R4.2: the program shown when the document has none (`isEmptyProgram`): the robot scenario's starter. It is not written to the
   * document while it is unchanged, so opening a lab is no edit for the host; the learner's first change writes it with the change, and
   * so does `saveNow` (Run compiles what the learner sees). Must be stable, like `toolbox`.
   */
  emptyProgram?: unknown;
  /** N18 R4.2: the workspace cannot be edited (a robot check runs). Blocks can still be looked at and scrolled. */
  readOnly?: boolean;
  ref?: Ref<BlocklyPanelHandle>;
};

/**
 * Whether a stored program has nothing in it: what Blockly saves for an empty workspace (`{}`, or nothing at all), or a workspace with
 * no block and no variable.
 */
export function isEmptyProgram(blocks: unknown): boolean {
  if (typeof blocks !== 'object' || blocks === null) {
    return true;
  }
  const { blocks: top, variables, ...rest } = blocks as { blocks?: { blocks?: unknown }; variables?: unknown };
  const none = (list: unknown) => list === undefined || (Array.isArray(list) && list.length === 0);
  return Object.keys(rest).length === 0 && none(top?.blocks) && none(variables);
}

/**
 * The block that shows `blockId` on screen: the block itself, or, when it is hidden inside collapsed blocks, the outermost of them
 * (N18 R4.2). Only blocks that hold it in an input count: a collapsed block before it in a stack does not hide it.
 */
function visibleBlockId(workspace: Blockly.WorkspaceSvg, blockId: string | null): string | null {
  const block = blockId === null ? null : workspace.getBlockById(blockId);
  if (block === null) {
    return blockId;
  }
  let shown = block;
  for (let around = block.getSurroundParent(); around !== null; around = around.getSurroundParent()) {
    if (around.isCollapsed()) {
      shown = around;
    }
  }
  return shown.id;
}

/** Shows `blockId` as the highlighted block (or none). Never throws: the block may be gone (Blockly then shows none). */
function showHighlight(workspace: Blockly.WorkspaceSvg | null, blockId: string | null) {
  if (workspace === null) {
    return;
  }
  try {
    workspace.highlightBlock(visibleBlockId(workspace, blockId));
  } catch (error) {
    console.warn('The running block could not be highlighted.', error);
  }
}

/**
 * Makes the warnings on `workspace` the record `wanted`, changing only what differs from `applied` (what this panel put there
 * before, id to text); `applied` is updated. A block that is not in the workspace is skipped, and stays unrecorded so that a later
 * call sets it once the block exists.
 */
function syncWarnings(workspace: Blockly.WorkspaceSvg | null, applied: Map<string, string>, wanted: Readonly<Record<string, string>>) {
  if (workspace === null) {
    return;
  }
  for (const blockId of [...applied.keys()]) {
    if (Object.hasOwn(wanted, blockId)) {
      continue;
    }
    applied.delete(blockId);
    workspace.getBlockById(blockId)?.setWarningText(null, diagnosticWarningId);
  }
  for (const [blockId, text] of Object.entries(wanted)) {
    const block = workspace.getBlockById(blockId);
    if (block === null) {
      applied.delete(blockId);
    } else if (applied.get(blockId) !== text) {
      block.setWarningText(text, diagnosticWarningId);
      applied.set(blockId, text);
    }
  }
}

export function BlocklyPanel({
  projectStore,
  packs,
  toolbox,
  fitOnLoad = false,
  onLoadFailed,
  highlightBlockId = null,
  blockWarnings,
  emptyProgram,
  readOnly = false,
  ref,
}: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const saveNowRef = useRef<() => void>(() => {});
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
  const loadFailed = useEffectEvent(() => onLoadFailed?.());
  const isReadOnly = useEffectEvent(() => readOnly);
  // N18 R2.4: the workspace of the current load (null between loads), what it shows of the run, and what the caller last asked for.
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const shownHighlightRef = useRef<string | null>(null);
  const highlightThrottleRef = useRef<LatestThrottle<string | null> | null>(null);
  const appliedWarningsRef = useRef(new Map<string, string>());
  const wantedWarningsRef = useRef<Readonly<Record<string, string>>>({});
  useImperativeHandle(ref, () => ({ saveNow: () => saveNowRef.current() }), []);

  // Rebuilt whenever a project is loaded (even one with the same id) or the
  // toolbox changes (another profile), but not on the panel's own saves or any
  // other store update.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    registerBlocks(packs);
    const workspace = Blockly.inject(container, {
      renderer: 'zelos',
      theme: stemTheme,
      toolbox: toolbox as Blockly.utils.toolbox.ToolboxInfo,
      media: blocklyMediaUrl(import.meta.env.BASE_URL),
      sounds: false,
      maxInstances: { [blockTypes.onStart]: 1, [blockTypes.forever]: 1 },
    });

    workspace.registerToolboxCategoryCallback('VARIABLE', ybcVariablesFlyout);

    // The stored and the host's programs were checked on a headless workspace before they got here (canOpenProgram); a program
    // that still fails (a check only the drawn editor makes, or one opened another way) must not take the whole page down. Blockly
    // stops in the middle of such a load, so the workspace is emptied and nothing of it is ever saved.
    let loaded = true;
    // N18 R4.2: what the starter (emptyProgram) saves as, while it is what the workspace shows unchanged; null otherwise.
    let pristine: string | null = null;
    try {
      const stored = projectStore.getState().document.program.blocks;
      const showsStarter = emptyProgram !== undefined && isEmptyProgram(stored);
      const blocks = showsStarter ? emptyProgram : stored;
      if (typeof blocks === 'object' && blocks !== null) {
        Blockly.serialization.workspaces.load(blocks, workspace);
      }
      if (fitOnLoad) {
        fitBlocksIntoView(workspace);
      }
      if (showsStarter) {
        pristine = JSON.stringify(Blockly.serialization.workspaces.save(workspace));
      }
    } catch (error) {
      loaded = false;
      console.warn('The program could not be opened in the block editor.', error);
      Blockly.Events.disable();
      try {
        workspace.clear();
      } finally {
        Blockly.Events.enable();
      }
    }

    let pendingSave: ReturnType<typeof setTimeout> | undefined;
    /** `explicit`: saveNow (Run), which writes an unchanged starter too; the delayed saves of edits leave it out of the document. */
    const save = (explicit = false) => {
      clearTimeout(pendingSave);
      pendingSave = undefined;
      const state = projectStore.getState();
      // This workspace belongs to one load: once another project is loaded,
      // its pending, flushed or Run-time saves must never overwrite it.
      // Nor does one that did not load: it is not the document's program.
      if (!loaded || state.loadRevision !== loadRevision) {
        return;
      }
      const { document, setProgramBlocks } = state;
      const serialized = Blockly.serialization.workspaces.save(workspace);
      const text = JSON.stringify(serialized);
      if (!explicit && pristine !== null && text === pristine && isEmptyProgram(document.program.blocks)) {
        return;
      }
      if (text !== JSON.stringify(document.program.blocks)) {
        setProgramBlocks(serialized);
      }
    };

    workspace.addChangeListener(Blockly.Events.disableOrphans);
    workspace.addChangeListener((event) => {
      if (!event.isUiEvent) {
        clearTimeout(pendingSave);
        pendingSave = setTimeout(save, saveDelayMs);
      }
    });

    // Reads the workspace itself, so edits whose events are still queued count too.
    saveNowRef.current = () => save(true);

    const resizeObserver = new ResizeObserver(() => Blockly.svgResize(workspace));
    resizeObserver.observe(container);

    // N18 R4.2: a workspace loaded while a check runs is locked too.
    workspace.setIsReadOnly(isReadOnly());

    // N18 R2.4: a new workspace has none of the run's marks: put back what the run showed and what the caller asked for.
    workspaceRef.current = workspace;
    appliedWarningsRef.current = new Map();
    syncWarnings(workspace, appliedWarningsRef.current, wantedWarningsRef.current);
    showHighlight(workspace, shownHighlightRef.current);

    if (!loaded) {
      loadFailed();
    }

    return () => {
      workspaceRef.current = null;
      saveNowRef.current = () => {};
      resizeObserver.disconnect();
      if (pendingSave !== undefined) {
        save();
      }
      workspace.dispose();
    };
  }, [loadRevision, projectStore, packs, toolbox, fitOnLoad, emptyProgram]);

  // N18 R4.2: a check locks the workspace and its end unlocks it.
  useEffect(() => {
    workspaceRef.current?.setIsReadOnly(readOnly);
  }, [readOnly]);

  // N18 R2.4: the block the program is in. Throttled; the workspace is read when a value is shown, so a project loaded meanwhile gets it.
  useEffect(() => {
    const throttle = createLatestThrottle<string | null>(
      (blockId) => {
        shownHighlightRef.current = blockId;
        showHighlight(workspaceRef.current, blockId);
      },
      highlightDelayMs,
      shownHighlightRef.current,
    );
    highlightThrottleRef.current = throttle;
    return () => {
      throttle.dispose();
      highlightThrottleRef.current = null;
    };
  }, []);
  useEffect(() => {
    highlightThrottleRef.current?.request(highlightBlockId);
  }, [highlightBlockId]);

  // N18 R2.4: the warnings on blocks. Compared with what is shown, so a caller that builds a new record every render costs nothing.
  useEffect(() => {
    wantedWarningsRef.current = blockWarnings ?? {};
    syncWarnings(workspaceRef.current, appliedWarningsRef.current, wantedWarningsRef.current);
  }, [blockWarnings]);

  return <div ref={containerRef} className="blockly-panel" data-testid="blockly-panel" />;
}
