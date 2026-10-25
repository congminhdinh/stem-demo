import { projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';

// The robot labs an embedding page can launch by key (N18 R4.1, `lab=robot`). Like the generic and Yolo:Bit keys they are a public
// contract: course content stores them (LabTemplateCatalog, STEMLearning), so a key is never renamed or reused. A key names a
// SCENARIO (the arena, the goals and the score come with R3.x and R6); what this module owns is the project it opens with
// (plan §4.0) and the profile it needs.

/** The scenarios of the robot lab, in the order of the lessons; `rb-sandbox` has no goals and no score. */
export const robotTemplateKeys = [
  'rb-drive-to-zone',
  'rb-square-route',
  'rb-stop-at-wall',
  'rb-line-follow',
  'rb-servo-gate',
  'rb-mini-mission',
  'rb-sandbox',
] as const;

export type RobotTemplateKey = (typeof robotTemplateKeys)[number];

/** The board profiles a robot lab can be launched with (`profile=`), from the Basic board up: each one has all of the one before. */
export const robotLabProfiles = ['uno-basic', 'uno-advanced'] as const;

export type RobotLabProfile = (typeof robotLabProfiles)[number];

/** The kit of every robot scenario for now (plan §4.0, §4.2): which modules the robot has and on which ports. */
export const robotKitId = 'ref-uno-rover';
export const robotKitVersion = '0';

/** The message key of a scenario's title, which the UI says in its language (src/ui/i18n/messages.ts). */
export type RobotTitleKey = `robot.scenario.${RobotTemplateKey}`;

export type RobotTemplate = {
  /** The profile the scenario needs, which it opens with when the launch names none; a launch with a lower one is refused. */
  profile: RobotLabProfile;
  kit: typeof robotKitId;
  titleKey: RobotTitleKey;
};

/** Every scenario needs the Basic board today; the table, not the launch parser, is where a scenario that needs more says so. */
export const robotTemplates: Readonly<Record<RobotTemplateKey, Readonly<RobotTemplate>>> = Object.fromEntries(
  robotTemplateKeys.map((key) => [key, { profile: 'uno-basic', kit: robotKitId, titleKey: `robot.scenario.${key}` }]),
) as Record<RobotTemplateKey, RobotTemplate>;

/** Exact, case-sensitive match against the list; no lookup on an object, so "constructor" is not a key. */
export const isRobotTemplateKey = (key: string): key is RobotTemplateKey => (robotTemplateKeys as readonly string[]).includes(key);

export const isRobotLabProfile = (value: string): value is RobotLabProfile => (robotLabProfiles as readonly string[]).includes(value);

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

/** The scenario version and the top score of every robot scenario, until the scenario data of R3.5 brings its own. */
const scenarioVersion = 1;
const maxScore = 100;

/**
 * What a robot lab adds to `ready` (plan §4.7): the scenario's version and, for a scored scenario, its top score. The sandbox has no
 * goals, so it has no score and the field is left out, never null.
 */
export function robotReadyFields(key: RobotTemplateKey): { scenarioVersion: number; maxScore?: number } {
  return key === 'rb-sandbox' ? { scenarioVersion } : { scenarioVersion, maxScore };
}

/**
 * The project of a robot scenario (plan §4.0), new on every call: the UNO board alone (a robot's wiring is its kit's, not wires),
 * the profile, the kit, and an empty program until the robot blocks of R2.2 give the learner something to place. Schema version
 * stays 1. The empty program is `{}`, which is what Blockly itself saves for an empty workspace: written so, opening the lab changes
 * nothing in the project, and the host is sent no project-changed.
 */
export function robotStarterDocument(key: RobotTemplateKey, profile?: RobotLabProfile): ProjectDocument {
  const needed = robotTemplates[key].profile;
  if (profile !== undefined) {
    const problem = robotTemplateProfileProblem(key, profile);
    if (problem !== null) {
      throw new RangeError(problem);
    }
  }
  return projectDocumentSchema.parse({
    schemaVersion: 1,
    id: `template-${key}`,
    name: 'Robot',
    profile: profile ?? needed,
    kit: { id: robotKitId, version: robotKitVersion },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks: {} },
  });
}
