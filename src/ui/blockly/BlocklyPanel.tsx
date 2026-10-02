import * as Blockly from 'blockly';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useStore } from 'zustand';
import { blockTypes, buildBlockDefinitions, toolbox } from '../../core/program/blocks';
import type { ProjectStore } from '../state/project-store';

// Blockly is only a view of `document.program.blocks` (plan §5.1 B4): the
// workspace is loaded from that JSON and every non-UI change is serialized
// back into the store. No Blockly object ever leaves this file.

const saveDelayMs = 250;

let blocksRegistered = false;

function registerBlocks(boardPins: readonly string[]) {
  if (!blocksRegistered) {
    Blockly.common.defineBlocksWithJsonArray(buildBlockDefinitions(boardPins));
    blocksRegistered = true;
  }
}

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
  /** Must be a stable array: a new one would rebuild the workspace. */
  boardPins: readonly string[];
  ref?: Ref<BlocklyPanelHandle>;
};

export function BlocklyPanel({ projectStore, boardPins, ref }: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const saveNowRef = useRef<() => void>(() => {});
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
  useImperativeHandle(ref, () => ({ saveNow: () => saveNowRef.current() }), []);

  // Rebuilt whenever a project is loaded (even one with the same id), but not
  // on the panel's own saves or any other store update.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    registerBlocks(boardPins);
    const workspace = Blockly.inject(container, {
      renderer: 'zelos',
      toolbox,
      media: '/blockly-media/',
      sounds: false,
      maxInstances: { [blockTypes.onStart]: 1, [blockTypes.forever]: 1 },
    });

    const blocks = projectStore.getState().document.program.blocks;
    if (typeof blocks === 'object' && blocks !== null) {
      Blockly.serialization.workspaces.load(blocks, workspace);
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
  }, [loadRevision, projectStore, boardPins]);

  return <div ref={containerRef} className="blockly-panel" data-testid="blockly-panel" />;
}
