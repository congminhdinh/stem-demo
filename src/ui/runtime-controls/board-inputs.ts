import type { ComponentInput } from '../../core/simulation/simulate-circuit';

// What the UI keeps of the inputs it gave a run (N17 B2), to draw them: the latest input of each part (a button held, the
// light's and the temperature's level, the tilt) and how many one-shot events each part had (the shakes). A shake is an event,
// never the part's input: it does not replace the tilt, here as in the run (run-session.ts). Runtime state, never the document.

export type BoardInputs = {
  /** The latest input of each part, by component id (`<board>/<part>`). */
  inputs: Readonly<Record<string, ComponentInput>>;
  /** How many one-shot events (shakes) each part had, by component id. */
  events: Readonly<Record<string, number>>;
};

export const noBoardInputs: BoardInputs = { inputs: {}, events: {} };

/** `state` with `input` given to `componentId`: a gesture counts as an event of the part, anything else is its latest input. */
export function withBoardInput(state: BoardInputs, componentId: string, input: ComponentInput): BoardInputs {
  if (input.kind === 'gesture') {
    const count = Object.hasOwn(state.events, componentId) ? (state.events[componentId] ?? 0) : 0;
    return { ...state, events: { ...state.events, [componentId]: count + 1 } };
  }
  return { ...state, inputs: { ...state.inputs, [componentId]: input } };
}
