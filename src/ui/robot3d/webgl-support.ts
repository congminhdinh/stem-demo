import type { MessageKey } from '../i18n/messages';

// When the robot lab draws its 2D top view (TopView2D) instead of the 3D scene (N18 R4.6), and what it tells the learner. The WebGL probe
// itself is quality.ts's (`probeWebgl`); this is the decision taken from what the probe, the scene's context events and the learner said.
//
//   no WebGL         the probe found none (a school PC, a locked-down browser, a virtual desktop): 2D from the start.
//   context lost     the browser took the scene's WebGL context away (a GPU reset, too many contexts) and did not give it back within
//                    CONTEXT_RESTORE_WAIT_MS: 2D until it does. The scene stays mounted meanwhile, so the browser's `webglcontextrestored`
//                    brings 3D back by itself.
//   chosen           the learner picked "Xem 2D" (a slow computer, or they like the map).
//
// The run, the check and the controls live outside both views and read the same snapshot, so a switch never touches the simulation.

/** How long a lost WebGL context may take to come back before the 2D view takes over. */
export const CONTEXT_RESTORE_WAIT_MS = 2000;

export type ViewFallbackReason = 'no-webgl' | 'context-lost' | 'chosen';

/** The scene's WebGL context: working, lost and waited for, or lost for longer than CONTEXT_RESTORE_WAIT_MS. */
export type ContextState = 'ok' | 'lost' | 'gone';

/** Why the 2D view stands in for the 3D scene now, or null while the 3D scene is shown. */
export function fallbackReason({ webgl, context, chosen2d }: { webgl: boolean; context: ContextState; chosen2d: boolean }): ViewFallbackReason | null {
  if (!webgl) return 'no-webgl';
  if (chosen2d) return 'chosen';
  return context === 'gone' ? 'context-lost' : null;
}

/** The note under the 2D view that says why it is there; none when the learner asked for it. */
export const fallbackNoteKey: Readonly<Record<ViewFallbackReason, MessageKey | null>> = {
  'no-webgl': 'robot.topview.noWebgl',
  'context-lost': 'robot.topview.contextLost',
  chosen: null,
};

/** What the button over the view does: switch to the 2D map, back to 3D, or look again for the WebGL that was missing or lost. */
export type ViewToggleAction = 'show2d' | 'show3d' | 'retry3d';

/** The action of the view button when the view is `fallback` (null: the 3D scene is up). */
export function viewToggleAction(fallback: ViewFallbackReason | null): ViewToggleAction {
  if (fallback === null) return 'show2d';
  return fallback === 'chosen' ? 'show3d' : 'retry3d';
}

/** The words of each action: the button's label and its hint. */
export const viewToggleText: Readonly<Record<ViewToggleAction, { label: MessageKey; hint: MessageKey }>> = {
  show2d: { label: 'robot.view.show2d', hint: 'robot.view.hint2d' },
  show3d: { label: 'robot.view.show3d', hint: 'robot.view.hint3d' },
  retry3d: { label: 'robot.view.retry3d', hint: 'robot.view.hintRetry3d' },
};
