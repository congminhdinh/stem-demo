import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import blinkSample from './blink.project.json';
import buttonDirectSample from './button-direct.project.json';
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';

// The labs an embedding page can launch by key (S1, plan §9.2). The keys are
// a public contract: lesson content stores them, so a key is never renamed or
// reused. The documents stay inside the simulator; only keys travel.

export const templateKeys = ['blink', 'led-on', 'button-direct', 'button-led', 'empty'] as const;

export type TemplateKey = (typeof templateKeys)[number];

const bundledSamples: Record<Exclude<TemplateKey, 'empty'>, unknown> = {
  blink: blinkSample,
  'led-on': ledOnSample,
  'button-direct': buttonDirectSample,
  'button-led': buttonLedSample,
};

/** Exact, case-sensitive match against the list; no lookup on an object, so "constructor" is not a key. */
export function isTemplateKey(value: string): value is TemplateKey {
  return (templateKeys as readonly string[]).includes(value);
}

/**
 * A fresh document for `key`, the same on every call. It is a deep copy:
 * schema parsing alone would hand out the bundled sample's own program
 * object, so an edit of one launch could reach the next.
 */
export function createTemplateProject(key: TemplateKey): ProjectDocument {
  return key === 'empty'
    ? createNewProject('template-empty')
    : projectDocumentSchema.parse(structuredClone(bundledSamples[key]));
}
