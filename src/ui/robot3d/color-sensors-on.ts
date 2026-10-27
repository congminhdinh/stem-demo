import { shownRun, type RobotLabState } from './robot-run-store';

// N19 final fix (G2 I1): the colour sensors the run in view sets up (robot-run-session.ts `colorSensorsOn`: its program has a colour block, or
// it is teleop, which begins the sensor), for a Run, every round of Kiểm tra and "Xem lại lượt N" alike. Both views draw a colour sensor's
// ray, spot and tag line only for one of these: lessons 8, 9 and 11 have no colour block, and their tag said "Màu: chưa có số đọc" on every
// run. Null when no run says (no run in view, or a kit with no colour sensor): the views draw the sensor as they always did
// (sensor-overlay-math.ts `colorSensorShown`). The same array for the whole of a run, so a view that selects it renders once a run.

/** The colour sensors the shown run sets up, by role; null when no run says. */
export const shownColorSensorsOn = (state: RobotLabState): readonly string[] | null => shownRun(state)?.colorSensorsOn ?? null;
