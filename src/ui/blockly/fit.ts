import type * as Blockly from 'blockly';

// A lab's program in sight (N8s): the starter blocks of a lab are placed for a wide frame (R6), and a narrow
// program column would show only part of them. This only changes the view (scale and scroll), which Blockly
// never serializes: the document, and so the host's copy of it, stays as it was.

/** Smaller than this the blocks are hard to read: the learner scrolls to the rest instead. */
export const minFitScale = 0.6;
/** Room left around the blocks, in pixels. */
const margin = 16;

/** The scale that shows a `contentWidth` × `contentHeight` (workspace units) program in a `viewWidth` × `viewHeight` view: never larger than `scale`. */
export function fittedScale(scale: number, content: { width: number; height: number }, view: { width: number; height: number }): number {
  if (content.width <= 0 || content.height <= 0) {
    return scale;
  }
  const room = Math.min((view.width - 2 * margin) / content.width, (view.height - 2 * margin) / content.height);
  return Math.max(minFitScale, Math.min(scale, room));
}

/** Shrinks the workspace, if needed, so that every block is in sight, and brings the blocks into the view. */
export function fitBlocksIntoView(workspace: Blockly.WorkspaceSvg): void {
  const box = workspace.getBlocksBoundingBox();
  const content = { width: box.right - box.left, height: box.bottom - box.top };
  const view = workspace.getMetricsManager().getViewMetrics();
  const scale = fittedScale(workspace.scale, content, view);
  const fits = content.width * workspace.scale + 2 * margin <= view.width && content.height * workspace.scale + 2 * margin <= view.height;
  if (fits || content.width <= 0) {
    return;
  }
  workspace.setScale(scale);
  workspace.scrollBoundsIntoView(box, margin);
}
