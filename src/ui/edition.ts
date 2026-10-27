// ==========================================================================================================================================
// DEMO-BASIC BRANCH ONLY: NEVER MERGE demo-basic INTO master.
// This file makes the Basic demo the default edition (anything but VITE_STEM_EDITION=full). Merged into master, it would turn master's
// lab into the Basic demo. Merge master into demo-basic only (git merge origin/master), never the other way round.
// ==========================================================================================================================================

import type { RobotTemplateKey } from '../samples/robot-keys';

// The edition of the lab (demo-basic branch, 2026-10-28): `full` is master's lab; `basic` is the "Bản demo cơ bản / Basic demo", a labelled,
// lighter tier of the same code. Every area Basic hides is built and works in `full`: Basic switches it off at runtime, it deletes nothing.
// In Basic the robot lab
//   - draws the low graphics tier (no shadows, pixel ratio 1, no antialiasing) with the procedural shapes of R4.2 (RobotView, ArenaView):
//     the modelled GLB files are never fetched, and the quality button is hidden;
//   - has one camera, the free orbit view, with no glide: no camera-mode buttons; "đặt lại góc nhìn", a results card's framing and the
//     start of a replay are instant; a drag keeps the full lab's damping;
//   - shows no sensor overlays (in 3D and on the 2D map), none of the three view tools (Lái tay, Thước đo, Di chuyển robot), no C++ and
//     no Cổng & chân tab;
//   - opens only `basicRobotTemplates`; any other scenario key is refused at launch with "Kịch bản này không có trong bản demo cơ bản";
//   - shows the badge "Bản demo cơ bản" in its header, and the page title says it too.
// Physics, sensors, the interpreter, Kiểm tra and its score, the scenario files and the host's protocol are the same code in both (src/core
// is untouched), and the 2D map stands in where the computer cannot draw 3D, as in `full`. The Blockly and Yolo:Bit labs are the same.
//
// The edition is read from VITE_STEM_EDITION when the app is built or served (Vite: the environment or a .env file); on this branch
// anything but `full` is `basic`. `VITE_STEM_EDITION=full` gives master's lab from the same code.

export type Edition = 'full' | 'basic';

/** The edition `value` (VITE_STEM_EDITION) names: `full` only when it says so, `basic` otherwise (this branch's default). */
export function editionOf(value: unknown): Edition {
  return value === 'full' ? 'full' : 'basic';
}

/** The edition of this build. */
export const EDITION: Edition = editionOf(import.meta.env.VITE_STEM_EDITION);

/** This build is the Basic demo. */
export const isBasic = (): boolean => EDITION === 'basic';

/** The robot scenarios the Basic demo opens (owner's decision, 2026-10-28): three of the rover's lessons and the sandbox, in lesson order. */
export const basicRobotTemplates = ['rb-drive-to-zone', 'rb-stop-at-wall', 'rb-line-follow', 'rb-sandbox'] as const satisfies readonly RobotTemplateKey[];

/** Whether `edition` opens the robot scenario `key`: `full` opens every one. */
export function editionHasRobotTemplate(key: RobotTemplateKey, edition: Edition = EDITION): boolean {
  return edition === 'full' || (basicRobotTemplates as readonly string[]).includes(key);
}

/**
 * Why `edition` does not open the robot scenario `key` (English, for the page that built the launch URL, as launch.ts says its problems),
 * or null when it does. The lab says it in its own words (`edition.notInBasic`, LaunchError).
 */
export function editionTemplateProblem(key: RobotTemplateKey, edition: Edition = EDITION): string | null {
  return editionHasRobotTemplate(key, edition) ? null : `The scenario "${key}" is not in the basic demo.`;
}

/** Whether a launch's problem is `editionTemplateProblem`'s. */
export const isEditionTemplateProblem = (problem: string): boolean => /^The scenario "[^"]*" is not in the basic demo\.$/.test(problem);
