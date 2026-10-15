import { blankFrame, DISPLAY_HEIGHT, DISPLAY_WIDTH, isFrame, type HexColour } from '../../core/capabilities/frame';
import {
  peripheralComponentId,
  type ComponentState,
  type SimulationResult,
} from '../../core/simulation/simulate-circuit';

// How the UI reads the display and the other onboard parts out of the run snapshot. The renderer (the
// drawn cells) and the text representation both come from `renderedPixels`, so they cannot disagree.

/** An onboard part's state in the snapshot (`<board>/<part>`); undefined while idle or before it reported. */
export function partStateOf(
  simulation: SimulationResult | null,
  boardId: string,
  partId: string,
): ComponentState | undefined {
  const id = peripheralComponentId(boardId, partId);
  // Component ids are data: "constructor" must not resolve to a member of Object.prototype.
  return simulation && Object.hasOwn(simulation.components, id) ? simulation.components[id] : undefined;
}

/** The 25 cells as they are drawn: a colour for a lit one, null for one that is off; all off unless the state has a well-formed frame. */
export function renderedPixels(state: ComponentState | undefined): (HexColour | null)[] {
  const frame = state?.frame;
  return [...(isFrame(frame) ? frame.pixels : blankFrame().pixels)];
}

/** The same cells as text: DISPLAY_HEIGHT lines of DISPLAY_WIDTH characters, '#' lit and '.' off. */
export function displayLines(state: ComponentState | undefined): string[] {
  const pixels = renderedPixels(state);
  return Array.from({ length: DISPLAY_HEIGHT }, (_, row) =>
    pixels
      .slice(row * DISPLAY_WIDTH, (row + 1) * DISPLAY_WIDTH)
      .map((pixel) => (pixel === null ? '.' : '#'))
      .join(''),
  );
}
