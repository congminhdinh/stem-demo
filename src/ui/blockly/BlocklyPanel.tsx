import * as Blockly from 'blockly';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react';
import { useStore } from 'zustand';
import { blockTypes } from '../../core/program/blocks';
import type { BlockPackCatalog, Toolbox } from '../../core/program/block-packs';
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { fitBlocksIntoView } from './fit';
import { blocklyMediaUrl } from './media';
import { stemTheme } from './theme';

// Blockly is only a view of `document.program.blocks` (plan §5.1 B4): the
// workspace is loaded from that JSON and every non-UI change is serialized
// back into the store. No Blockly object ever leaves this file.

const saveDelayMs = 250;

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
  ref?: Ref<BlocklyPanelHandle>;
};

export function BlocklyPanel({ projectStore, packs, toolbox, fitOnLoad = false, onLoadFailed, ref }: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const saveNowRef = useRef<() => void>(() => {});
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
  const loadFailed = useEffectEvent(() => onLoadFailed?.());
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
    try {
      const blocks = projectStore.getState().document.program.blocks;
      if (typeof blocks === 'object' && blocks !== null) {
        Blockly.serialization.workspaces.load(blocks, workspace);
      }
      if (fitOnLoad) {
        fitBlocksIntoView(workspace);
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
    const save = () => {
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
      if (JSON.stringify(serialized) !== JSON.stringify(document.program.blocks)) {
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
    saveNowRef.current = save;

    const resizeObserver = new ResizeObserver(() => Blockly.svgResize(workspace));
    resizeObserver.observe(container);

    if (!loaded) {
      loadFailed();
    }

    return () => {
      saveNowRef.current = () => {};
      resizeObserver.disconnect();
      if (pendingSave !== undefined) {
        save();
      }
      workspace.dispose();
    };
  }, [loadRevision, projectStore, packs, toolbox, fitOnLoad]);

  return <div ref={containerRef} className="blockly-panel" data-testid="blockly-panel" />;
}
