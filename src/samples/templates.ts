import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import blinkSample from './blink.project.json';
import buttonDirectSample from './button-direct.project.json';
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';
import { isRobotTemplateKey, robotStarterDocument, robotTemplateKeys, type RobotLabProfile, type RobotTemplateKey } from './robot-templates';
import { isYbcTemplateKey, templateProfileProblem, ybcStarterDocument, ybcTemplateKeys, type YbcLabProfile } from './ybc-templates';

// The labs an embedding page can launch by key (S1, plan §9.2; N6a S1 adds the Yolo:Bit keys). The keys are
// a public contract: lesson content stores them, so a key is never renamed or reused. The documents stay
// inside the simulator; only keys travel. The robot lab's keys (N18 R4.1) are in robot-templates.ts and are not part of
// `templateKeys`: that list is the keys of the legacy S1 launch, which has no robot lab.

/** The templates of a Blockly lab (`lab=blockly`), and of the legacy S1 launch. */
export const genericTemplateKeys = ['blink', 'led-on', 'button-direct', 'button-led', 'empty'] as const;

export const templateKeys = [...genericTemplateKeys, ...ybcTemplateKeys] as const;

export type TemplateKey = (typeof templateKeys)[number];

/** The kinds of lab of the launch URL (`lab=`): block programming on a generic board, the Yolo:Bit board, or (N18 R4.1) the 3D robot. */
export type LabKind = 'blockly' | 'yolobit' | 'robot';

/** The key of any template a `lab=` launch can name: the keys of `templateKeys` and the robot scenarios. */
export type LabTemplateKey = TemplateKey | RobotTemplateKey;

/** The board profiles of the launch's `profile=`: the Yolo:Bit levels and the robot's. */
export type LabProfile = YbcLabProfile | RobotLabProfile;

type GenericKey = (typeof genericTemplateKeys)[number];

const bundledSamples: Record<Exclude<GenericKey, 'empty'>, unknown> = {
  blink: blinkSample,
  'led-on': ledOnSample,
  'button-direct': buttonDirectSample,
  'button-led': buttonLedSample,
};

/** Exact, case-sensitive match against the list; no lookup on an object, so "constructor" is not a key. */
export function isTemplateKey(value: string): value is TemplateKey {
  return (templateKeys as readonly string[]).includes(value);
}

/** Whether `value` is the key of a template of some lab: a key of `templateKeys` or a robot scenario. */
export function isLabTemplateKey(value: string): value is LabTemplateKey {
  return isTemplateKey(value) || isRobotTemplateKey(value);
}

/** The lab a template opens in: the `rb-*` scenarios are robot labs, the `ybc-*` templates Yolo:Bit labs, every other one a Blockly lab. */
export function labOfTemplate(key: LabTemplateKey): LabKind {
  return isRobotTemplateKey(key) ? 'robot' : isYbcTemplateKey(key) ? 'yolobit' : 'blockly';
}

/** The templates `lab` accepts, in the order of `templateKeys` (the robot's: of `robotTemplateKeys`). */
export function templateKeysOf(lab: LabKind): LabTemplateKey[] {
  return lab === 'robot' ? [...robotTemplateKeys] : templateKeys.filter((key) => labOfTemplate(key) === lab);
}

export type TemplateOptions = {
  /**
   * The board profile of a Yolo:Bit or robot template (the launch's `profile=`); ignored for a generic template. Without it a
   * template opens with the profile it needs (N17 B6); one lower than that, or of another family, is refused, here and by the
   * launch (launch.ts) before it gets here.
   */
  profile?: LabProfile;
};

/**
 * A fresh document for `key`, the same on every call. It is a deep copy:
 * schema parsing alone would hand out the bundled sample's own program
 * object, so an edit of one launch could reach the next.
 */
export function createTemplateProject(key: LabTemplateKey, options: TemplateOptions = {}): ProjectDocument {
  if (isRobotTemplateKey(key)) {
    return robotStarterDocument(key, options.profile === undefined ? undefined : robotProfileOf(options.profile));
  }
  if (isYbcTemplateKey(key)) {
    const document = projectDocumentSchema.parse(ybcStarterDocument(key));
    if (!options.profile) {
      return document;
    }
    const profile = ybcProfileOf(options.profile);
    const problem = templateProfileProblem(key, profile);
    if (problem !== null) {
      throw new RangeError(problem);
    }
    return { ...document, profile };
  }
  return key === 'empty'
    ? createNewProject('template-empty')
    : projectDocumentSchema.parse(structuredClone(bundledSamples[key]));
}

/** `profile` as a robot profile, or a RangeError: a Yolo:Bit level does not open a robot scenario. */
function robotProfileOf(profile: LabProfile): RobotLabProfile {
  if (profile !== 'uno-basic' && profile !== 'uno-advanced') {
    throw new RangeError(`The profile "${profile}" is not a robot profile: use uno-basic or uno-advanced.`);
  }
  return profile;
}

/** `profile` as a Yolo:Bit level, or a RangeError: a robot profile does not open a Yolo:Bit template. */
function ybcProfileOf(profile: LabProfile): YbcLabProfile {
  if (profile !== 'ybc-basic' && profile !== 'ybc-advanced') {
    throw new RangeError(`The profile "${profile}" is not a Yolo:Bit profile: use ybc-basic or ybc-advanced.`);
  }
  return profile;
}
