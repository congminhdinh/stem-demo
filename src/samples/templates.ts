import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import blinkSample from './blink.project.json';
import buttonDirectSample from './button-direct.project.json';
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';
import { isYbcTemplateKey, templateProfileProblem, ybcStarterDocument, ybcTemplateKeys, type YbcLabProfile } from './ybc-templates';

// The labs an embedding page can launch by key (S1, plan §9.2; N6a S1 adds the Yolo:Bit keys). The keys are
// a public contract: lesson content stores them, so a key is never renamed or reused. The documents stay
// inside the simulator; only keys travel.

/** The templates of a Blockly lab (`lab=blockly`), and of the legacy S1 launch. */
export const genericTemplateKeys = ['blink', 'led-on', 'button-direct', 'button-led', 'empty'] as const;

export const templateKeys = [...genericTemplateKeys, ...ybcTemplateKeys] as const;

export type TemplateKey = (typeof templateKeys)[number];

/** The two kinds of lab of the launch URL (`lab=`): block programming on a generic board, or the Yolo:Bit board. */
export type LabKind = 'blockly' | 'yolobit';

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

/** The lab a template opens in: the `ybc-*` templates are Yolo:Bit labs, every other one a Blockly lab. */
export function labOfTemplate(key: TemplateKey): LabKind {
  return isYbcTemplateKey(key) ? 'yolobit' : 'blockly';
}

/** The templates `lab` accepts, in the order of `templateKeys`. */
export function templateKeysOf(lab: LabKind): TemplateKey[] {
  return templateKeys.filter((key) => labOfTemplate(key) === lab);
}

export type TemplateOptions = {
  /**
   * The board profile of a Yolo:Bit template (the launch's `profile=`); ignored for a generic template. Without it a template opens
   * with the profile it needs (N17 B6); one lower than that is refused, here and by the launch (launch.ts) before it gets here.
   */
  profile?: YbcLabProfile;
};

/**
 * A fresh document for `key`, the same on every call. It is a deep copy:
 * schema parsing alone would hand out the bundled sample's own program
 * object, so an edit of one launch could reach the next.
 */
export function createTemplateProject(key: TemplateKey, options: TemplateOptions = {}): ProjectDocument {
  if (isYbcTemplateKey(key)) {
    const document = projectDocumentSchema.parse(ybcStarterDocument(key));
    if (!options.profile) {
      return document;
    }
    const problem = templateProfileProblem(key, options.profile);
    if (problem !== null) {
      throw new RangeError(problem);
    }
    return { ...document, profile: options.profile };
  }
  return key === 'empty'
    ? createNewProject('template-empty')
    : projectDocumentSchema.parse(structuredClone(bundledSamples[key]));
}
