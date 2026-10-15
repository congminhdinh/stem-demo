import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { displayLines } from './display-view';

/**
 * The display as text, 5 lines of 5 characters ('#' lit, '.' off), for whoever cannot see the board
 * (plan §19). It comes from the snapshot's frame only. It is not a live region: a scrolling text
 * changes it every 200 ms, and announcing that would drown everything else.
 */
export function DisplayText({ display }: { display: ComponentState | undefined }) {
  return (
    <pre className="display-text" role="group" aria-label="Display text" data-testid="display-text">
      {displayLines(display).join('\n')}
    </pre>
  );
}
