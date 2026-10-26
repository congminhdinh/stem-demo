import type * as Blockly from 'blockly';

// A lab's program in sight (N8s): the starter blocks of a lab are placed for a wide frame (R6), and a narrow
// program column would show only part of them. This only changes the view (scale and scroll), which Blockly
// never serializes: the document, and so the host's copy of it, stays as it was.
//
// N18 bt-lab-fix (c4): the robot lab, and only it (`robotFit`, passed by App's robot branch), does more for a program the host loads or the
// learner's last one restored (the LMS sends it as a load-project), which the learner placed wherever they dragged it: it is zoomed out to
// fit, down to the robot lab's smallest scale, and scrolled so that its top-left is in sight even when it fits but stands out of the view; a
// program wider than the view at that scale shows its top-left and the rest is a scroll away; a program loaded into an editor with no size
// yet is fitted once it has one. The other labs (Blockly, Yolo:Bit) keep what N8s gave them, step for step. Only a load calls this: the
// learner's own edits, scrolls and zooms never come back here.

/** Smaller than this the blocks are hard to read: the learner scrolls to the rest instead. */
export const minFitScale = 0.6;
/**
 * The robot lab's smallest (N18 bt-lab-fix, c4): its programs are wide (a row of a sensor's reading, a comparison and its number) and its
 * program column is narrow next to the 3D view and the toolbox, so at 0.6 the end of the row was cut in the LMS's frame. At 0.5 the text is
 * still just readable (12 px at 1 is 6 px), and the numbers and units at the end of a row show; below it they would not be.
 */
export const minRobotFitScale = 0.5;
/** Room left around the blocks, in pixels. */
const margin = 16;

/** What a lab asks of the fit; nothing asked is what the Blockly and Yolo:Bit labs have always had. */
export type FitOptions = {
  /** The smallest scale it may zoom out to; `minFitScale` by default. */
  minScale?: number;
  /** Also scroll the top-left of the blocks into sight when they fit but are not in it, and say when the view had no size (the robot lab). */
  inSight?: boolean;
};
/** The robot lab's fit (N18 bt-lab-fix, c4). */
export const robotFit: FitOptions = Object.freeze({ minScale: minRobotFitScale, inSight: true });

/**
 * The scale that shows a `contentWidth` × `contentHeight` (workspace units) program in a `viewWidth` × `viewHeight` view: never larger than
 * `scale`, never smaller than `minScale`.
 */
export function fittedScale(scale: number, content: { width: number; height: number }, view: { width: number; height: number }, minScale: number = minFitScale): number {
  if (content.width <= 0 || content.height <= 0) {
    return scale;
  }
  const room = Math.min((view.width - 2 * margin) / content.width, (view.height - 2 * margin) / content.height);
  return Math.max(minScale, Math.min(scale, room));
}

/**
 * Shrinks the workspace, if needed, so that every block is in sight (down to the smallest scale), and brings the blocks into the view.
 * With `inSight` (the robot lab) it also scrolls so that the top-left of the blocks is in sight when they are not, and returns false, having
 * changed nothing, when the view has no size yet (the editor is in a frame that is not shown): the caller does this again once the view has
 * one. Without it, it does what it always did, and returns true.
 */
export function fitBlocksIntoView(workspace: Blockly.WorkspaceSvg, options: FitOptions = {}): boolean {
  const { minScale = minFitScale, inSight = false } = options;
  const box = workspace.getBlocksBoundingBox();
  const content = { width: box.right - box.left, height: box.bottom - box.top };
  const metrics = workspace.getMetricsManager();
  const view = metrics.getViewMetrics();
  if (!inSight) {
    // N8s, as it was: the other labs' view changes only when the program does not fit.
    const scale = fittedScale(workspace.scale, content, view, minScale);
    const fits = content.width * workspace.scale + 2 * margin <= view.width && content.height * workspace.scale + 2 * margin <= view.height;
    if (fits || content.width <= 0) {
      return true;
    }
    workspace.setScale(scale);
    workspace.scrollBoundsIntoView(box, margin);
    return true;
  }
  if (content.width <= 0 || content.height <= 0) {
    return true;
  }
  // Not `<= 0`: a container that is not shown can measure as NaN.
  if (!(view.width > 0) || !(view.height > 0)) {
    return false;
  }
  const scale = fittedScale(workspace.scale, content, view, minScale);
  if (scale !== workspace.scale) {
    workspace.setScale(scale);
  }
  // In the workspace's own units, at the scale now: the part of it the view shows.
  const shown = metrics.getViewMetrics(true);
  const seen = box.left >= shown.left && box.top >= shown.top && box.right <= shown.left + shown.width && box.bottom <= shown.top + shown.height;
  if (!seen) {
    workspace.scrollBoundsIntoView(box, margin);
  }
  return true;
}
