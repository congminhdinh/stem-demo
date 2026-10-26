import { shownRun, type RobotLabState } from './robot-run-store';

// The colours of the objects in the round the view shows (N19 E4/E5, ruling 8 on the E4/E5 report): what the run's world painted them
// (robot-run-session.ts `objectColors`: the variant's arena, what the colour sensor reads), for a Run, every round of Kiểm tra at 1× and
// 4×, the round a check left in view and "Xem lại lượt N" alike. The views paint the objects from it; without it (no run shown, or a
// scenario whose variants recolour nothing, as every rover lesson) they paint the arena's own colours, which are variant 0's. The same object
// for the whole of a run, so a view that selects it renders once a run.

/** The shown round's object colours, by id; null when the view paints the arena's own. */
export const shownObjectColors = (state: RobotLabState): Readonly<Record<string, string>> | null => shownRun(state)?.objectColors ?? null;

/** An object's colour as a view paints it: the shown round's when it has one, else its own (the arena's), or none. */
export function paintedColor(colors: Readonly<Record<string, string>> | null, id: string, own: string | undefined): string | undefined {
  return colors !== null && Object.hasOwn(colors, id) ? colors[id] : own;
}
