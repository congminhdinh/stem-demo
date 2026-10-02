import * as Blockly from 'blockly';
import { useEffect, useRef } from 'react';
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

type BlocklyPanelProps = {
  projectStore: ProjectStore;
  /** Must be a stable array: a new one would rebuild the workspace. */
  boardPins: readonly string[];
};

export function BlocklyPanel({ projectStore, boardPins }: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const documentId = useStore(projectStore, (state) => state.document.id);

  // Rebuilt only when another project is opened, not on every store update.
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
      pendingSave = undefined;
      const { document, setProgramBlocks } = projectStore.getState();
      if (document.id !== documentId) {
        return;
      }
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

    const resizeObserver = new ResizeObserver(() => Blockly.svgResize(workspace));
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (pendingSave !== undefined) {
        clearTimeout(pendingSave);
        save();
      }
      workspace.dispose();
    };
  }, [documentId, projectStore, boardPins]);

  return <div ref={containerRef} className="blockly-panel" data-testid="blockly-panel" />;
}
