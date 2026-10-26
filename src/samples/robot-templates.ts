import { projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import {
  robotKitVersionOf,
  robotLabProfiles,
  robotTemplates,
  type RobotLabProfile,
  type RobotTemplateKey,
} from './robot-keys';
import { scenarioReadyFields, scenarioReadyGoals } from './robot-scenarios/ready-fields';

// The table of keys, profiles and kits lives in robot-keys.ts, a module with no imports, so that the scenario schema (src/core/scenario)
// and the scenario catalog can read it without importing this file (which reads the scenario files, N18 R5.2: that would be a cycle).
// It is re-exported here, so that everything that reads the table through this module keeps doing so.
export {
  isRobotKitId,
  isRobotLabProfile,
  isRobotTemplateKey,
  robotKitId,
  robotKits,
  robotKitVersion,
  robotKitVersionOf,
  robotLabProfiles,
  robotSandboxKey,
  robotTemplateKeys,
  robotTemplates,
  type RobotKitId,
  type RobotLabProfile,
  type RobotTemplate,
  type RobotTemplateKey,
  type RobotTitleKey,
} from './robot-keys';

// The robot labs an embedding page can launch by key (N18 R4.1, `lab=robot`). Like the generic and Yolo:Bit keys they are a public
// contract: course content stores them (LabTemplateCatalog, STEMLearning), so a key is never renamed or reused. A key names a
// SCENARIO (the arena, the goals and the score come with R3.x and R6); what this module owns is the project it opens with
// (plan §4.0) and the profile it needs.

/** N19 A4: the kit a robot lab runs on, at the version it launches it at (robot-keys.ts `robotTemplates`, `robotKitVersionOf`). */
export function robotTemplateKitRef(key: RobotTemplateKey): { readonly id: string; readonly version: string } {
  const id = robotTemplates[key].kit;
  return { id, version: robotKitVersionOf(id) };
}

/**
 * Why `profile` cannot open `key` (English, for the page that built the launch URL, in the words of the Yolo:Bit labs), or null when
 * it can: it has all the scenario needs. `needed` is that profile, the scenario's own by default; a test that wants to see a
 * scenario refuse a lower level gives another one, so that no test has to change the table.
 */
export function robotTemplateProfileProblem(key: RobotTemplateKey, profile: RobotLabProfile, needed: RobotLabProfile = robotTemplates[key].profile): string | null {
  return robotLabProfiles.indexOf(profile) >= robotLabProfiles.indexOf(needed)
    ? null
    : `The template "${key}" needs profile=${needed}: it uses blocks or parts that ${profile} does not have.`;
}

/**
 * What a robot lab adds to `ready` (plan §4.7): the scenario's version and, for a scored scenario, its top score, read from the scenario's
 * file (robot-scenarios/ready-fields.ts, held to the catalog by its test). The sandbox has no goals, so it has no score and the field is
 * left out, never null. A new object on every call. Every key has a scenario file (the catalog's test), so a key without one is a bug and throws.
 */
export function robotReadyFields(key: RobotTemplateKey): { scenarioVersion: number; maxScore?: number } {
  const fields = scenarioReadyFields(key);
  if (fields === undefined) {
    throw new Error(`The robot scenario "${key}" has no file in src/samples/robot-scenarios.`);
  }
  return { ...fields };
}

/**
 * The goals a robot lab lists in `ready` (N18 R6.3, lab-embed-contract §2): each goal's id and its label in `locale`, in the scenario's order,
 * read from the scenario's file like `robotReadyFields`. A scored check-result lists the same ids in the same order. The sandbox has none.
 */
export function robotReadyGoals(key: RobotTemplateKey, locale: 'vi' | 'en'): { id: string; label: string }[] {
  const goals = scenarioReadyGoals(key);
  if (goals === undefined) {
    throw new Error(`The robot scenario "${key}" has no file in src/samples/robot-scenarios.`);
  }
  return goals.map((goal) => ({ id: goal.id, label: goal.label[locale] }));
}

/**
 * The project of a robot scenario (plan §4.0), new on every call: the UNO board alone (a robot's wiring is its kit's, not wires),
 * the profile, the kit, and an empty program until the robot blocks of R2.2 give the learner something to place. Schema version
 * stays 1. The empty program is `{}`, which is what Blockly itself saves for an empty workspace: written so, opening the lab changes
 * nothing in the project, and the host is sent no project-changed. `profile` is the launch's, refused (RangeError) when lower than
 * `needed`, the level the scenario needs (its own by default, as in `robotTemplateProfileProblem`); a project opens with `profile`, or
 * with `needed` when the launch gave none.
 */
export function robotStarterDocument(key: RobotTemplateKey, profile?: RobotLabProfile, needed: RobotLabProfile = robotTemplates[key].profile): ProjectDocument {
  if (profile !== undefined) {
    const problem = robotTemplateProfileProblem(key, profile, needed);
    if (problem !== null) {
      throw new RangeError(problem);
    }
  }
  return projectDocumentSchema.parse({
    schemaVersion: 1,
    id: `template-${key}`,
    name: 'Robot',
    profile: profile ?? needed,
    kit: { id: robotTemplates[key].kit, version: robotKitVersionOf(robotTemplates[key].kit) },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks: {} },
  });
}
