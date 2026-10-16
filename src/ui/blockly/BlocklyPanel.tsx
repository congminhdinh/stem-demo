import * as Blockly from 'blockly';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
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
  ref?: Ref<BlocklyPanelHandle>;
};

export function BlocklyPanel({ projectStore, packs, toolbox, fitOnLoad = false, ref }: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const saveNowRef = useRef<() => void>(() => {});
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
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

    const blocks = projectStore.getState().document.program.blocks;
    if (typeof blocks === 'object' && blocks !== null) {
      Blockly.serialization.workspaces.load(blocks, workspace);
    }
    if (fitOnLoad) {
      fitBlocksIntoView(workspace);
    }

    let pendingSave: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(pendingSave);
      pendingSave = undefined;
      const state = projectStore.getState();
      // This workspace belongs to one load: once another project is loaded,
      // its pending, flushed or Run-time saves must never overwrite it.
      if (state.loadRevision !== loadRevision) {
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
